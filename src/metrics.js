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
let inspectorCache = null;
let inspectorPromise = null;

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

/**
 * On-demand hardware inspector data. This is intentionally not part of the
 * seven-second loop: motherboard, BIOS, disk-layout and adapter identity are
 * useful when requested, but they are not live dashboard metrics.
 * Serial numbers and MAC addresses are excluded at the boundary.
 */
async function getInspector(force) {
  if (force) {
    inspectorCache = null;
    inspectorPromise = null;
  }
  if (inspectorCache && !force) return inspectorCache;
  const staticData = await getStatic();
  if (!inspectorPromise) {
    inspectorPromise = Promise.all([
      safe(() => si.system(), {}),
      safe(() => si.bios(), {}),
      safe(() => si.baseboard(), {}),
      safe(() => si.memLayout(), []),
      safe(() => si.diskLayout(), []),
      safe(() => si.graphics(), { controllers: [], displays: [] }),
      safe(() => si.networkInterfaces(), []),
      safe(() => si.battery(), {}),
      safe(() => si.osInfo(), {})
    ]).then(([system, bios, baseboard, memory, disks, graphics, network, battery, osInfo]) => ({
      cpu: {
        model: staticData.cpuModel || null, cores: staticData.cpuCores || null,
        physicalCores: staticData.cpuPhysicalCores || null
      },
      os: {
        platform: staticData.os && staticData.os.platform || osInfo.platform || null,
        distro: staticData.os && staticData.os.distro || osInfo.distro || null,
        release: staticData.os && staticData.os.release || osInfo.release || null,
        codename: osInfo.codename || null, build: osInfo.build || null
      },
      system: {
        manufacturer: system.manufacturer || null, model: system.model || null,
        version: system.version || null, sku: system.sku || null, virtual: !!system.virtual
      },
      bios: {
        vendor: bios.vendor || null, version: bios.version || null,
        releaseDate: bios.releaseDate || null, revision: bios.revision || null
      },
      baseboard: {
        manufacturer: baseboard.manufacturer || null, model: baseboard.model || null,
        version: baseboard.version || null, memMax: baseboard.memMax || null, memSlots: baseboard.memSlots || null
      },
      memory: (Array.isArray(memory) ? memory : []).map((item) => ({
        size: item.size || 0, bank: item.bank || null, type: item.type || null,
        clockSpeed: item.clockSpeed || null, formFactor: item.formFactor || null,
        manufacturer: item.manufacturer || null, partNum: item.partNum || null
      })),
      storage: (Array.isArray(disks) ? disks : []).map((item) => ({
        device: item.device || null, type: item.type || null, name: item.name || null,
        vendor: item.vendor || null, size: item.size || 0, interfaceType: item.interfaceType || null,
        firmwareRevision: item.firmwareRevision || null, smartStatus: item.smartStatus || null,
        temperature: Number.isFinite(item.temperature) ? item.temperature : null
      })),
      graphics: {
        controllers: (graphics && Array.isArray(graphics.controllers) ? graphics.controllers : []).map((item) => ({
          vendor: item.vendor || null, model: item.model || item.name || null,
          vram: item.vram || item.memoryTotal || null, driverVersion: item.driverVersion || null,
          utilization: item.utilizationGpu != null ? item.utilizationGpu : item.utilization,
          temperature: item.temperatureGpu != null ? item.temperatureGpu : item.temperature
        })),
        displays: (graphics && Array.isArray(graphics.displays) ? graphics.displays : []).map((item) => ({
          vendor: item.vendor || null, model: item.model || null, connection: item.connection || null,
          resolutionX: item.currentResX || item.resolutionX || null, resolutionY: item.currentResY || item.resolutionY || null,
          refreshRate: item.currentRefreshRate || null, positionX: item.positionX || 0, positionY: item.positionY || 0,
          main: !!item.main
        }))
      },
      network: (Array.isArray(network) ? network : []).map((item) => ({
        iface: item.iface || null, ifaceName: item.ifaceName || null, default: !!item.default,
        type: item.type || null,
        operstate: item.operstate || null, speed: item.speed || null
      })),
      battery: battery && battery.hasBattery ? {
        percent: Number.isFinite(battery.percent) ? battery.percent : null,
        charging: !!battery.charging, acConnected: !!battery.acConnected,
        cycleCount: Number.isFinite(battery.cycleCount) ? battery.cycleCount : null
      } : null
    }));
  }
  try {
    inspectorCache = await inspectorPromise;
  } catch (err) {
    inspectorPromise = null;
    throw err;
  }
  return inspectorCache;
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
const HOME_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'];
let networkSession = {
  iface: null, lastAt: 0, lastRxBytes: null, lastTxBytes: null,
  downloaded: 0, uploaded: 0, peakRx: 0, peakTx: 0
};

// Filesystems that are not storage a user thinks about. `si.fsSize()` reports
// every mount, so an unfiltered list on Linux/WSL is eight lines of squashfs
// snap loops, tmpfs and 9p drivers with truncated paths — which reads like a
// raw `df` dump rather than a disk panel. Windows is unaffected (C:, D:, …).
const PSEUDO_FS = /^(squashfs|tmpfs|devtmpfs|devpts|overlay|ramfs|proc|sysfs|cgroup2?|autofs|nsfs|tracefs|debugfs|binfmt_misc|fusectl|configfs|pstore|securityfs|mqueue|hugetlbfs|efivarfs|fuse\..*|rpc_pipefs|selinuxfs)$/i;
const PSEUDO_MOUNT = /^\/(proc|sys|dev|snap)(\/|$)/;

function isUserFacingDisk(d) {
  if (!(d.size > 0)) return false;                       // zero-size pseudo mounts
  const type = String(d.type || '');
  if (type && PSEUDO_FS.test(type)) return false;
  const mount = String(d.mount || '');
  if (PSEUDO_MOUNT.test(mount)) return false;
  return true;
}

function listFolders() {
  const home = os.homedir();
  const out = [];
  for (const f of HOME_FOLDERS) {
    try {
      const p = path.join(home, f);
      fs.accessSync(p, fs.constants.R_OK);
      let count = 0;
      try { count = fs.readdirSync(p).length; } catch (_) { /* unreadable but present */ }
      out.push({ name: f, path: p, count });
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
  if (want(sections, 'disks')) jobs.io = safe(() => si.disksIO(), null);
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
    .filter(isUserFacingDisk)
    .map((d) => ({
      fs: d.fs || '?', mount: d.mount || '?', used: d.used || 0, size: d.size || 0,
      use: typeof d.use === 'number' ? +d.use.toFixed(1) : 0, available: d.available || 0,
      type: d.type || null
    }))
    // Largest first: the filesystem the user cares about is almost always the
    // biggest one. Root is pinned ahead of equal-footing mounts.
    .sort((a, b) => (b.size - a.size))
    .slice(0, 6);

  const netList = r.net || [];
  const activeNet = netList.find((n) => n.rx_sec > 0 || n.tx_sec > 0 || n.rx_bytes > 0 || n.tx_bytes > 0) || netList[0] || {};
  const networkNow = Date.now();
  const rxBytes = Number.isFinite(activeNet.rx_bytes) ? activeNet.rx_bytes : null;
  const txBytes = Number.isFinite(activeNet.tx_bytes) ? activeNet.tx_bytes : null;
  const sameInterface = networkSession.iface === (activeNet.iface || '?');
  const elapsed = sameInterface && networkSession.lastAt ? Math.max(1, networkNow - networkSession.lastAt) : 0;
  const rxDelta = sameInterface && rxBytes != null && networkSession.lastRxBytes != null && rxBytes >= networkSession.lastRxBytes ? rxBytes - networkSession.lastRxBytes : 0;
  const txDelta = sameInterface && txBytes != null && networkSession.lastTxBytes != null && txBytes >= networkSession.lastTxBytes ? txBytes - networkSession.lastTxBytes : 0;
  const rxSec = Number.isFinite(activeNet.rx_sec) ? Math.max(0, activeNet.rx_sec) : (elapsed ? (rxDelta * 1000) / elapsed : 0);
  const txSec = Number.isFinite(activeNet.tx_sec) ? Math.max(0, activeNet.tx_sec) : (elapsed ? (txDelta * 1000) / elapsed : 0);
  if (!sameInterface) {
    networkSession = { iface: activeNet.iface || '?', lastAt: networkNow, lastRxBytes: rxBytes, lastTxBytes: txBytes, downloaded: 0, uploaded: 0, peakRx: 0, peakTx: 0 };
  } else {
    networkSession.iface = activeNet.iface || '?';
    networkSession.lastAt = networkNow;
    networkSession.lastRxBytes = rxBytes;
    networkSession.lastTxBytes = txBytes;
    networkSession.downloaded += rxDelta;
    networkSession.uploaded += txDelta;
    networkSession.peakRx = Math.max(networkSession.peakRx, rxSec);
    networkSession.peakTx = Math.max(networkSession.peakTx, txSec);
  }

  const processes = ((r.procs || {}).list || [])
    .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
    .slice(0, 8)
    .map((p) => ({
      name: String(p.name || '?').substring(0, 18),
      pid: Number.isInteger(p.pid) ? p.pid : null,
      path: typeof p.path === 'string' && path.isAbsolute(p.path) ? p.path : null,
      cpu: +(p.cpu || 0).toFixed(1),
      mem: +(p.mem || 0).toFixed(1)
    }));

  const bat = r.battery || {};
  const io = r.io && typeof r.io === 'object' ? {
    readBytes: Number.isFinite(r.io.rIO) ? r.io.rIO : null,
    writeBytes: Number.isFinite(r.io.wIO) ? r.io.wIO : null,
    readBytesSec: Number.isFinite(r.io.rIO_sec) ? r.io.rIO_sec : null,
    writeBytesSec: Number.isFinite(r.io.wIO_sec) ? r.io.wIO_sec : null
  } : null;
  return {
    at: Date.now(),
    gpu: gpus.length ? gpus : null,
    disks,
    network: {
      iface: activeNet.iface || '?', operstate: activeNet.operstate || null,
      rx_sec: rxSec, tx_sec: txSec, rx_bytes: rxBytes, tx_bytes: txBytes,
      sessionDownloaded: networkSession.downloaded, sessionUploaded: networkSession.uploaded,
      peakRx: networkSession.peakRx, peakTx: networkSession.peakTx
    },
    diskIO: io,
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
    calls: keys.map((k) => ({ gpu: 'graphics', disks: 'fsSize', io: 'disksIO', net: 'networkStats', procs: 'processes', battery: 'battery', temps: 'cpuTemperature', mem: 'mem', fs: 'local readdir' }[k] || k))
  };
}

/** Fresh, main-process-only lookup used by explicit process actions. */
async function inspectProcess(pid) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff) return { ok: false, error: 'invalid process id' };
  try {
    const result = await si.processes();
    const item = ((result && result.list) || []).find((entry) => entry.pid === pid);
    if (!item) return { ok: false, error: 'process not found' };
    return {
      ok: true,
      pid,
      name: String(item.name || '?').substring(0, 80),
      path: typeof item.path === 'string' && path.isAbsolute(item.path) ? item.path : null,
      command: String(item.command || '').substring(0, 240)
    };
  } catch (err) {
    return { ok: false, error: 'process lookup failed: ' + err.message };
  }
}

/** Drop every cache. Used by the benchmark and the self-test. */
function reset() {
  staticCache = null;
  staticPromise = null;
  cpuPrev = null;
  meminfoWarned = false;
  inspectorCache = null;
  inspectorPromise = null;
  networkSession = { iface: null, lastAt: 0, lastRxBytes: null, lastTxBytes: null, downloaded: 0, uploaded: 0, peakRx: 0, peakTx: 0 };
}

module.exports = {
  collectFast, collectSlow, inspectProcess, getStatic, getInspector, reset,
  info: {
    fastSource: 'node:os' + (IS_LINUX ? ' + /proc/meminfo' : ''),
    slowSource: 'systeminformation',
    slowCalls: ['graphics', 'fsSize', 'networkStats', 'processes', 'battery', 'cpuTemperature']
  }
};
