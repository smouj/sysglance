#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const metrics = require('../src/metrics');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

(async function () {
  console.log('SysGlance — process verification');
  check('invalid PID is rejected without provider access', (await metrics.inspectProcess(0)).ok === false);
  const data = await metrics.collectSlow({ sections: { gpu: false, disks: false, network: false, battery: false, cpu: false, filesystem: false, processes: true } });
  check('process provider returns an array', Array.isArray(data.processes));
  const valid = data.processes.filter((item) => item.pid != null);
  check('returned PIDs are non-negative integers', valid.every((item) => Number.isInteger(item.pid) && item.pid >= 0));
  check('System Idle Process is excluded from user-facing ranking', valid.every((item) => item.pid !== 0 && String(item.name || '').toLowerCase() !== 'system idle process'));
  check('returned paths are absolute or absent', valid.every((item) => !item.path || path.isAbsolute(item.path)));
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  check('end-task requires a confirmation dialog', main.includes("title: 'End task?'"));
  check('end-task uses an argument array', main.includes("execFile('taskkill.exe', ['/PID'"));
  check('process actions revalidate the PID', main.includes('const inspected = await metrics.inspectProcess(pid)'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
