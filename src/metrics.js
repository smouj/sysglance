'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — metrics collection
//
// Three deliberately separate tiers, because the old implementation called
// eight `systeminformation` functions on every 1500 ms tick and that module
// shells out (df/ps/lscpu/sensors/wmic/powershell depending on the platform).
// Measured before this refactor: 13.4 child processes and ~83 ms per cycle
// (see scripts/bench-metrics.js).
//
//   STATIC  once per session — CPU model, core count, OS identity.
//           Nothing here changes while the app runs.
//   FAST    config.refreshInterval (500–5000 ms, default 1500) — Node core
//           only: `os.cpus()` deltas for load, `os.totalmem()` (plus
//           /proc/meminfo MemAvailable on Linux, which is the same number the
//           task manager shows), `os.uptime()`, `os.loadavg()`. In-process,
//           zero child processes.
//   SLOW    config.slowInterval (5–10 s, default 7 s) — `systeminformation`,
//           and only for what Node genuinely cannot read: GPU, temperatures,
//           disks, network counters, top processes, battery. Sections the user
//           has hidden are not queried at all.
//
// `collectFast()`/`collectSlow()` return raw tier data; composing the payload
// the renderer consumes is the main process's job (src/main.js).
// ═══════════════════════════════════════════════════════

const os = require('os');
const fs = require('fs');
const path = require('path');
const si = require('systeminformation');

const IS_LINUX = process.platform === 'linux';
const CPU_PRIME_MS = 150;   // one-time wait so the first load reading is real

const CPU_MODEL_FALLBACK = 'CPU';

// ── static tier ─────────────────────────────────────────
let staticCache = null;
let staticPromise = null;

async function safe(fn, fallback) {
  try {
    const v = await fn();
    return v === undefined || v === null ? (fallback === undefined ? {} : fallback) : v;
  } catch (_) {
    return fallback === undefined ? {} : fallback;
  }
}

/**
 * CPU model/cores come from `os.cpus()` (in-process — `si.cpu()` would spawn
 * lscpu/dmesg/clinfo for the same string). Only the OS identity needs
 * systeminformation, and only once per session.
 */
async function getStatic(force) {
  if (staticCache && !force) return staticCache;
  if (!staticPromise) {
    staticPromise = (async () => {
      const cpus = os.cpus();
      const first = cpus[0] || {};
      const osInfo = await safe(() => si.osInfo(), {});
      const distro = osInfo.distro || '';
      const release = osInfo.release || '';
      return {
        cpuModel: String(first.model || CPU_MODEL_FALLBACK).replace(/\s+/g, ' ').trim().substring(0, 44),
        cpuCores: cpus.length,
        cpuSpeedMhz: typeof first.speed === 'number' && first.speed > 0 ? first.speed : null,
        os: {
          distro: distro || (osInfo.platform || process.platform),
          release: release || os.release(),
          hostname: osInfo.hostname || os.hostname(),
          arch: osInfo.arch || os.arch(),
          platform: osInfo.platform || process.platform
        }
      };
    })();
  }
  try {
    staticCache = await staticPromise;
  } catch (err) {
    staticPromise = null;
    throw err;
  }
  return staticCache;
}

// ── fast tier (no child processes) ──────────────────────
let cpuPrev = null;

function cpuSnapshot() {
  const cpus = os.cpus();
  const per = [];
  let total = 0, busy = 0;
  for (const c of cpus) {
    const t = c.times || { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const b = t.user + t.nice + t.sys + t.irq;
    const tot = b + t.idle;
    per.push({ busy: b, total: tot });
    busy += b;
    total += tot;
  }
  return { per, total, busy };
}

function pct(part, whole) {
  if (!(whole > 0)) return 0;
  const v = (part / whole) * 100;
  return Math.min(100, Math.max(0, +v.toFixed(1)));
}

function loadFrom(prev, now) {
  const perCore = now.per.map((c, i) => {
    const p = prev.per[i];
    if (!p) return 0;
    return pct(c.busy - p.busy, c.total - p.total);
  });
  return { overall: pct(now.busy - prev.busy, now.total - prev.total), perCore };
}

// Linux reports MemFree without reclaimable cache, so a monitor built on it
// shows ~10 points more usage than the OS does. MemAvailable is the honest
// number and comes from one small in-process read (no spawn).
let meminfoWarned = false;
function readMeminfo() {
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const out = {};
    for (const raw of txt.split('\n')) {
      const i = raw.indexOf(':');
      if (i < 0) continue;
      const key = raw.slice(0, i);
      if (key !== 'MemTotal' && key !== 'MemAvailable' && key !== 'MemFree' && key !== 'SwapTotal' && key !== 'SwapFree') continue;
      const kb = parseInt(raw.slice(i + 1), 10);
      if (Number.isFinite(kb)) out[key] = kb * 1024;
    }
    return out;
  } catch (err) {
    if (!meminfoWarned) { meminfoWarned = true; }
    return null;
  }
}

function memoryTier() {
  const total = os.totalmem();
  let free = os.freemem();
  let swapTotal = 0, swapFree = 0;
  let source = 'os';
  if (IS_LINUX) {
    const mi = readMeminfo();
    if (mi) {
      if (typeof mi.MemAvailable === 'number') { free = mi.MemAvailable; source = 'os+meminfo'; }
      swapTotal = mi.SwapTotal || 0;
      swapFree = mi.SwapFree || 0;
    }
  }
  const used = Math.max(0, total - free);
  return {
    total, used, free,
    percentage: total > 0 ? +((used / total) * 100).toFixed(1) : 0,
    swapTotal, swapUsed: Math.max(0, swapTotal - swapFree),
    source
  };
}

/**
 * FAST tier. In-process only: os.cpus() deltas, os memory, uptime, loadavg.
 * Await this before using the result — the very first call primes the CPU
 * baseline (one 150 ms wait, once per session) so `load` is never a fake 0.
 */
async function collectFast() {
  if (!cpuPrev) {
    const baseline = cpuSnapshot();
    await new Promise((r) => setTimeout(r, CPU_PRIME_MS));
    cpuPrev = baseline;
  }
  const now = cpuSnapshot();
  const load = loadFrom(cpuPrev, now);
  cpuPrev = now;
  const cpus = os.cpus();
  const first = cpus[0] || {};
  return {
    at: Date.now(),
    cpu: {
      load: load.overall,
      perCore: load.perCore,
      cores: cpus.length,
      speedMhz: typeof first.speed === 'number' && first.speed > 0 ? first.speed : null
    },
    memory: memoryTier(),
    os: {
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      hostname: os.hostname(),
      arch: os.arch(),
      platform: process.platform
    }
  };
}

// ── slow tier (systeminformation, 5–10 s) ───────────────
const HOME_FOLDERS = [
  { name: 'Desktop', icon: '🖥️' }, { name: 'Documents', icon: '📄' },
  { name: 'Downloads', icon: '📥' }, { name: 'Pictures', icon: '🖼️' },
  { name: 'Videos', icon: '🎬' }, { name: 'Music', icon: '🎵' }
];

function listFolders() {
  const home = os.homedir();
  const out = [];
  for (const f of HOME_FOLDERS) {
    try {
      const p = path.join(home, f.name);
      fs.accessSync(p, fs.constants.R_OK);
      let count = 0;
      try { count = fs.readdirSync(p).length; } catch (_) { /* unreadable but present */ }
      out.push({ name: f.name, icon: f.icon, path: p, count });
    } catch (_) { /* folder absent */ }
  }
  return { home, folders: out };
}

const want = (sections, key) => !sections || sections[key] !== false;

/**
 * SLOW tier. Only the sections the user actually shows are queried, so hiding
 * e.g. Top Processes removes the single most expensive call on Windows.
 * Every call is failure-tolerant: a missing GPU or an unreadable temperature
 * sensor degrades that one field, never the cycle.
 */
async function collectSlow(opts) {
  const sections = (opts && opts.sections) || null;
  const jobs = {};
  if (want(sections, 'gpu')) jobs.gpu = safe(() => si.graphics(), { controllers: [] });
  if (want(sections, 'disks')) jobs.disks = safe(() => si.fsSize(), []);
  if (want(sections, 'network')) jobs.net = safe(() => si.networkStats(), []);
  if (want(sections, 'processes')) jobs.procs = safe(() => si.processes(), { list: [] });
  if (want(sections, 'battery')) jobs.battery = safe(() => si.battery(), {});
  if (want(sections, 'cpu')) jobs.temps = safe(() => si.cpuTemperature(), {});
  if (!IS_LINUX) jobs.mem = safe(() => si.mem(), {});   // swap on Windows/macOS
  if (want(sections, 'filesystem')) jobs.fs = Promise.resolve(listFolders());

  const keys = Object.keys(jobs);
  const values = await Promise.all(keys.map((k) => jobs[k]));
  const r = {};
  keys.forEach((k, i) => { r[k] = values[i]; });

  const temps = r.temps || {};
  const gpus = ((r.gpu || {}).controllers || []).map((g, i) => ({
    name: String(g.model || 'GPU').substring(0, 36),
    utilization: typeof g.utilization === 'number' ? g.utilization : null,
    vram: g.vram || null,
    vramUsed: typeof g.memoryUsed === 'number' ? g.memoryUsed : null,
    temp: temps[i] !== undefined && temps[i] !== null && temps[i] >= 0 ? temps[i] : (temps.main >= 0 ? temps.main : null)
  }));

  const disks = (r.disks || [])
    .map((d) => ({
      fs: d.fs || '?', mount: d.mount || '?', used: d.used || 0, size: d.size || 0,
      use: typeof d.use === 'number' ? +d.use.toFixed(1) : 0, available: d.available || 0
    }))
    .filter((d) => d.size > 0)
    .slice(0, 8);

  const netList = r.net || [];
  const activeNet = netList.find((n) => n.rx_sec > 0 || n.tx_sec > 0) || netList[0] || {};

  const processes = ((r.procs || {}).list || [])
    .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
    .slice(0, 8)
    .map((p) => ({
      name: String(p.name || '?').substring(0, 18),
      pid: p.pid,
      cpu: +(p.cpu || 0).toFixed(1),
      mem: +(p.mem || 0).toFixed(1)
    }));

  const bat = r.battery || {};
  return {
    at: Date.now(),
    gpu: gpus.length ? gpus : null,
    disks,
    network: { iface: activeNet.iface || '?', rx_sec: activeNet.rx_sec || 0, tx_sec: activeNet.tx_sec || 0 },
    processes,
    battery: bat.hasBattery ? { percent: bat.percent || 0, charging: !!bat.charging, acConnected: !!bat.acConnected } : null,
    memory: r.mem ? { swapTotal: r.mem.swaptotal || 0, swapUsed: r.mem.swapused || 0 } : null,
    temperature: {
      main: typeof temps.main === 'number' && temps.main >= 0 ? temps.main : null,
      max: typeof temps.max === 'number' && temps.max >= 0 ? temps.max : null
    },
    filesystem: r.fs || null,
    // Which systeminformation calls this cycle actually made — surfaced in the
    // UI so the split is visible instead of a claim in a README.
    calls: keys.map((k) => ({ gpu: 'graphics', disks: 'fsSize', net: 'networkStats', procs: 'processes', battery: 'battery', temps: 'cpuTemperature', mem: 'mem', fs: 'local readdir' }[k] || k))
  };
}

/** Drop every cache. Used by the benchmark and the self-test. */
function reset() {
  staticCache = null;
  staticPromise = null;
  cpuPrev = null;
  meminfoWarned = false;
}

module.exports = {
  collectFast, collectSlow, getStatic, reset,
  info: {
    fastSource: 'node:os' + (IS_LINUX ? ' + /proc/meminfo' : ''),
    slowSource: 'systeminformation',
    slowCalls: ['graphics', 'fsSize', 'networkStats', 'processes', 'battery', 'cpuTemperature']
  }
};
