#!/usr/bin/env node
'use strict';

const metrics = require('../src/metrics');
const fs = require('fs');
const os = require('os');
const path = require('path');
const si = require('systeminformation');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

(async function () {
  console.log('SysGlance — metric verification');
  metrics.reset();
  const identity = await metrics.getStatic();
  check('static identity has CPU and OS data', !!identity.cpuModel && !!identity.os && !!identity.os.release);
  const fast = await metrics.collectFast();
  check('fast tier returns bounded CPU and memory values', fast.cpu.load >= 0 && fast.cpu.load <= 100 && fast.memory.percentage >= 0 && fast.memory.percentage <= 100);
  const slow = await metrics.collectSlow({ sections: { gpu: false, battery: false, cpu: false, filesystem: false, processes: false, network: true, disks: true } });
  check('slow tier exposes network session fields', slow.network && Number.isFinite(slow.network.sessionDownloaded) && Number.isFinite(slow.network.peakRx));
  check('storage rows retain free space, filesystem and optional temperature', Array.isArray(slow.disks) && (!slow.disks.length || ('available' in slow.disks[0] && 'fs' in slow.disks[0] && 'temperature' in slow.disks[0])));
  const originalGraphics = si.graphics;
  const originalDiskIo = si.disksIO;
  try {
    si.graphics = () => Promise.reject(new Error('simulated GPU provider failure'));
    si.disksIO = () => Promise.reject(new Error('simulated disk I/O failure'));
    const degraded = await metrics.collectSlow({ sections: { gpu: true, disks: true, network: false, processes: false, battery: false, cpu: false, filesystem: false } });
    check('slow provider failures degrade fields without rejecting the cycle', degraded.gpu === null && degraded.diskIO === null && Array.isArray(degraded.disks) && degraded.calls.includes('graphics'));
  } finally {
    si.graphics = originalGraphics;
    si.disksIO = originalDiskIo;
  }
  const networkDetails = await metrics.getNetworkDetails(true);
  check('network adapter diagnostics are on-demand, not in the slow loop', networkDetails && Object.prototype.hasOwnProperty.call(networkDetails, 'ip4') && Object.prototype.hasOwnProperty.call(networkDetails, 'gateway') && Array.isArray(networkDetails.dns) && Object.prototype.hasOwnProperty.call(networkDetails, 'linkSpeed') && !slow.calls.includes('networkGatewayDefault'));
  check('disk I/O is nullable rather than fabricated', slow.diskIO === null || (typeof slow.diskIO === 'object' && Object.prototype.hasOwnProperty.call(slow.diskIO, 'readBytesSec')));
  const inspector = await metrics.getInspector();
  const serialized = JSON.stringify(inspector).toLowerCase();
  check('inspector includes hardware families', inspector.cpu && inspector.os && inspector.system && inspector.bios && inspector.baseboard && inspector.graphics && Array.isArray(inspector.storage) && Object.prototype.hasOwnProperty.call(inspector, 'battery'));
  check('inspector excludes MAC addresses, IPs and serial numbers', !serialized.includes('"mac"') && !serialized.includes('"ip4"') && !serialized.includes('serial'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sysglance-metrics-'));
  try {
    fs.mkdirSync(path.join(scratch, 'Documents'));
    fs.writeFileSync(path.join(scratch, 'Documents', 'note.txt'), 'bounded scan');
    const analysis = await metrics.analyzeFolder(scratch, { maxDepth: 2, maxEntries: 100 });
    check('folder analysis is opt-in, bounded and returns sizes', analysis.ok && analysis.entries && analysis.entries[0] && analysis.entries[0].name === 'Documents' && analysis.entries[0].size > 0 && analysis.visited <= 100);
  } finally { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {} }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
