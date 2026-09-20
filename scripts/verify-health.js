#!/usr/bin/env node
'use strict';

const { HistoryStore } = require('../src/history');
const { AlertEngine } = require('../src/alerts');
const { evaluateHealth, GB } = require('../src/health');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — history / health / alert verification');

const history = new HistoryStore({ intervalMs: 1000, retentionMs: 5000 });
check('history accepts first sample', history.record({ cpu: 10, memory: 20 }, 1000));
check('history coalesces samples inside interval', !history.record({ cpu: 11 }, 1500));
check('history accepts next interval', history.record({ cpu: 30, memory: 40 }, 2000));
history.record({ cpu: 50 }, 3000);
history.record({ cpu: 70 }, 4000);
history.record({ cpu: 90 }, 5000);
check('ring buffer remains bounded', history.buffers.cpu.size <= history.capacity, history.buffers.cpu.size + '/' + history.capacity);
check('window filters old points', history.series('cpu', 1500, 5000).length === 2);
check('summary exposes latest average and peak', history.snapshot(5000, 5000).summary.cpu.peak === 90);

const health = evaluateHealth({
  cpu: { load: 93, temp: 88 },
  memory: { percentage: 91 },
  gpu: [{ temp: 86 }],
  disks: [{ available: 9 * GB }],
  network: { iface: 'Ethernet' }
});
check('health identifies critical CPU', health.rows.find((item) => item.id === 'cpu').status === 'CRITICAL');
check('health identifies warning RAM', health.rows.find((item) => item.id === 'memory').status === 'WARNING');
check('health message stays objective', health.message.includes('measured item'));

const engine = new AlertEngine([{ id: 'test', label: 'Test threshold', severity: 'WARNING', durationMs: 1000, cooldownMs: 5000, read: (s) => s.value >= 10 }]);
check('alert starts normal', engine.snapshot().active.length === 0);
check('alert does not trigger before duration', engine.evaluate({ value: 10 }, 1000).transitions.length === 0);
check('alert triggers after duration', engine.evaluate({ value: 10 }, 2000).transitions[0].type === 'TRIGGERED');
check('alert remains active during cooldown', engine.evaluate({ value: 10 }, 3000).transitions.length === 0 && engine.snapshot().active.length === 1);
check('alert recovers when condition clears', engine.evaluate({ value: 0 }, 4000).transitions[0].type === 'RECOVERED');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
