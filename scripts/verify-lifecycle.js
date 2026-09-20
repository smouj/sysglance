'use strict';

const fs = require('fs');
const path = require('path');
const { LifecycleState } = require('../src/lifecycle');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — lifecycle verification');
const state = new LifecycleState();
check('starts active', state.snapshot().state === 'active');
check('suspend transitions once', state.suspend(1000) === true && state.snapshot().state === 'suspended');
check('suspend is idempotent', state.suspend(1100) === false && state.snapshot().suspendCount === 1);
check('suspend timestamp is retained', state.snapshot().suspendedAt === 1000);
check('resume transitions once', state.resume(2000) === true && state.snapshot().state === 'active');
check('resume is idempotent', state.resume(2100) === false && state.snapshot().resumedAt === 2000);
check('resume timestamp is exposed', state.snapshot().resumedAt === 2000);
check('second suspend increments count', state.suspend(3000) === true && state.snapshot().suspendCount === 2);

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const metrics = fs.readFileSync(path.join(__dirname, '..', 'src', 'metrics.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
check('main subscribes to powerMonitor suspend/resume', main.includes("powerMonitor.on('suspend'") && main.includes("powerMonitor.on('resume'"));
check('resume resets transient baselines and re-arms collection', main.includes('metrics.resume()') && main.includes('startDataCollection()') && main.includes('alertEngine.reset()'));
check('late provider results are discarded after a re-arm', main.includes('collectionEpoch') && main.includes('epoch !== collectionEpoch'));
check('resume drops rate baselines but preserves session totals', metrics.includes('function resume()') && metrics.includes('downloaded: networkSession.downloaded') && metrics.includes('lastRxBytes: null'));
check('renderer exposes paused monitoring status', renderer.includes('renderLifecycle') && html.includes('id="health-lifecycle"'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
