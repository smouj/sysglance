#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — refresh-cycle benchmark
//
// Measures the cost of one collection cycle before and after the
// performance refactor, on whatever machine it runs on:
//
//   legacy — the pre-refactor path, copied verbatim from
//            src/main.js@e6e22e4 collectSystemData()/getStaticData():
//            8 systeminformation calls per cycle + a 30 s static cache.
//   new    — src/metrics.js: an in-process `os` fast tier plus a
//            systeminformation slow tier with a per-session static cache.
//
// Reported per implementation: wall time per cycle (min/median/mean/max),
// process CPU time consumed, and how many *child processes* the cycle
// spawned (child_process is instrumented before systeminformation loads).
//
// Usage:
//   node scripts/bench-metrics.js [--iterations=N] [--legacy|--new]
// Exit code 0 always (this is a measurement, not a gate).
// ═══════════════════════════════════════════════════════

const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── instrument child_process BEFORE systeminformation is required ──
const spawns = { total: 0, byFile: Object.create(null) };
const PATCHED = ['spawn', 'exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork'];
for (const fn of PATCHED) {
  const orig = child_process[fn];
  if (typeof orig !== 'function') continue;
  child_process[fn] = function (...args) {
    spawns.total++;
    const cmd = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].file) || '?';
    const base = path.basename(String(cmd));
    spawns.byFile[base] = (spawns.byFile[base] || 0) + 1;
    return orig.apply(this, args);
  };
}

const si = require('systeminformation');
const LEGACY_REFRESH_MS = 1500;   // config.refreshInterval default, pre- and post-refactor
const LEGACY_STATIC_TTL = 30000;  // getStaticData() TTL before the refactor

const argv = process.argv.slice(2);
const iterations = Number((argv.find((a) => a.startsWith('--iterations=')) || '').split('=')[1]) || 8;
const only = argv.includes('--legacy') ? 'legacy' : argv.includes('--new') ? 'new' : 'both';

// ── legacy (pre-refactor) ────────────────────────────────
let legacyStatic = null, legacyStaticTime = 0;

async function legacyStaticData() {
  const now = Date.now();
  if (legacyStatic && (now - legacyStaticTime) < LEGACY_STATIC_TTL) return legacyStatic;
  const [cpu, osData, gpuData] = await Promise.all([
    si.cpu().catch(() => ({})), si.osInfo().catch(() => ({})), si.graphics().catch(() => ({}))
  ]);
  legacyStatic = { cpu, os: osData, gpu: gpuData };
  legacyStaticTime = now;
  return legacyStatic;
}

async function legacyCycle() {
  const [cpuLoad, mem, netData, diskData, processes, temps, batData, timeData] = await Promise.all([
    si.currentLoad(), si.mem(), si.networkStats(), si.fsSize(),
    si.processes(), si.cpuTemperature().catch(() => ({})),
    si.battery().catch(() => ({})), si.time()
  ]);
  const s = await legacyStaticData();
  const homeDir = os.homedir();
  for (const n of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music']) {
    try { fs.readdirSync(path.join(homeDir, n)).length; } catch (_) { /* absent */ }
  }
  return { cpuLoad, mem, netData, diskData, processes, temps, batData, timeData, s };
}

// ── measurement ──────────────────────────────────────────
function stats(list) {
  const s = list.slice().sort((a, b) => a - b);
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  return {
    min: s[0], median: s[Math.floor(s.length / 2)], mean: +mean.toFixed(2), max: s[s.length - 1]
  };
}

async function measure(label, run, n) {
  const times = [];
  const before = { cpu: process.cpuUsage(), spawned: spawns.total };
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    await run();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const cpu = process.cpuUsage(before.cpu);
  const spawned = spawns.total - before.spawned;
  const st = stats(times.map((t) => +t.toFixed(2)));
  console.log(
    '  ' + label.padEnd(34) +
    ' min ' + String(st.min).padStart(7) + ' ms' +
    '  med ' + String(st.median).padStart(7) + ' ms' +
    '  mean ' + String(st.mean).padStart(7) + ' ms' +
    '  max ' + String(st.max).padStart(7) + ' ms' +
    '  cpu ' + String((cpu.user + cpu.system) / 1000 / n).padStart(7) + ' ms/cycle' +
    '  spawns ' + String(spawned).padStart(3) + ' (' + (spawned / n).toFixed(2) + '/cycle)'
  );
  return { times: st, cpuMs: +((cpu.user + cpu.system) / 1000 / n).toFixed(2), spawned, perCycle: +(spawned / n).toFixed(2) };
}

(async function main() {
  console.log('SysGlance — refresh cycle benchmark');
  console.log('node ' + process.version + ' | platform ' + process.platform + ' | cpus ' + os.cpus().length +
    ' | systeminformation ' + require('systeminformation/package.json').version);
  console.log('iterations=' + iterations + '  legacy refresh=' + LEGACY_REFRESH_MS + ' ms\n');

  const out = {};

  if (only === 'legacy' || only === 'both') {
    console.log('LEGACY — src/main.js@e6e22e4 collectSystemData()');
    await legacyCycle();                       // warm: first call is the coldest
    await measure('cold cycle (static uncached)', async () => { legacyStatic = null; await legacyCycle(); }, 3);
    out.legacy = await measure('steady cycle (8 si calls)', legacyCycle, iterations);
  }

  let metrics = null;
  try {
    metrics = require(path.join(__dirname, '..', 'src', 'metrics.js'));
  } catch (e) {
    if (only !== 'legacy') console.log('\n(new tier unavailable: ' + e.message + ')');
  }

  if (metrics && (only === 'new' || only === 'both')) {
    console.log('\nNEW — src/metrics.js');
    metrics.reset();
    await metrics.collectFast();
    await metrics.getStatic();
    out.newFast = await measure('fast tier (os module only)', () => metrics.collectFast(), iterations);
    out.newSlow = await measure('slow tier (si, every 7 s)', () => metrics.collectSlow({ sections: { gpu: true, disks: true, network: true, processes: true, battery: true } }), Math.max(3, Math.ceil(iterations / 2)));
    const before = { spawned: spawns.total };
    const t0 = process.hrtime.bigint();
    metrics.reset();
    await metrics.getStatic();
    out.newStatic = {
      times: stats([Number(process.hrtime.bigint() - t0) / 1e6]),
      spawned: spawns.total - before.spawned
    };
    console.log('  ' + 'static tier (once per session)'.padEnd(34) + ' wall ' + out.newStatic.times.min.toFixed(2) +
      ' ms  spawns ' + out.newStatic.spawned);
  }

  if (out.legacy && out.newFast) {
    const perSecond = (cycleMs, intervalMs) => cycleMs / (intervalMs / 1000);
    const legacySec = perSecond(out.legacy.times.mean, LEGACY_REFRESH_MS);
    const newSec = perSecond(out.newFast.times.mean, LEGACY_REFRESH_MS) + perSecond(out.newSlow.times.mean, 7000);
    const legacySpawnPerSec = out.legacy.perCycle / (LEGACY_REFRESH_MS / 1000);
    const newSpawnPerSec = out.newSlow.perCycle / 7;
    console.log('\nSTEADY STATE (per second of uptime)');
    console.log('  legacy: ' + legacySec.toFixed(3) + ' ms/s compute   ' + legacySpawnPerSec.toFixed(2) + ' child processes/s');
    console.log('  new   : ' + newSec.toFixed(3) + ' ms/s compute   ' + newSpawnPerSec.toFixed(2) + ' child processes/s');
    console.log('  compute: ' + (legacySec / newSec).toFixed(2) + 'x lighter    spawns: ' +
      (legacySpawnPerSec / (newSpawnPerSec || 0.0001)).toFixed(2) + 'x fewer');
  }

  console.log('\nchild processes spawned during the whole run: ' + spawns.total +
    (spawns.total ? ' [' + Object.keys(spawns.byFile).map((k) => k + '×' + spawns.byFile[k]).join(', ') + ']' : ''));
})().catch((e) => { console.error('bench crashed:', e && e.stack ? e.stack : e); process.exit(1); });
