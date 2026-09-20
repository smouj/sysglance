#!/usr/bin/env node
'use strict';

const metrics = require('../src/metrics');

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
  check('disk I/O is nullable rather than fabricated', slow.diskIO === null || (typeof slow.diskIO === 'object' && Object.prototype.hasOwnProperty.call(slow.diskIO, 'readBytesSec')));
  const inspector = await metrics.getInspector();
  const serialized = JSON.stringify(inspector).toLowerCase();
  check('inspector includes hardware families', inspector.cpu && inspector.os && inspector.system && inspector.bios && inspector.baseboard && inspector.graphics && Array.isArray(inspector.storage) && Object.prototype.hasOwnProperty.call(inspector, 'battery'));
  check('inspector excludes MAC addresses, IPs and serial numbers', !serialized.includes('"mac"') && !serialized.includes('"ip4"') && !serialized.includes('serial'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
