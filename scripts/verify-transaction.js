#!/usr/bin/env node
'use strict';

const { runShellTransaction } = require('../src/shell/transaction');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

(async function () {
  console.log('SysGlance — shell transaction verification');
  let state = { taskbar: 'bottom', theme: 'dark' };
  const before = JSON.parse(JSON.stringify(state));
  const success = await runShellTransaction(before, [
    { label: 'taskbar position', run: async () => { state.taskbar = 'left'; return { ok: true, changed: true }; } },
    { label: 'theme', run: async () => { state.theme = 'light'; return { ok: true, changed: true }; } }
  ], async (snapshot) => { state = JSON.parse(JSON.stringify(snapshot)); return { ok: true }; });
  check('successful transaction applies every step', success.ok && state.taskbar === 'left' && state.theme === 'light');
  state = JSON.parse(JSON.stringify(before));
  let ranAfterFailure = false;
  const failure = await runShellTransaction(before, [
    { label: 'taskbar position', run: async () => { state.taskbar = 'right'; return { ok: true }; } },
    { label: 'wallpaper', run: async () => ({ ok: false, error: 'wallpaper unavailable' }) },
    { label: 'must not run', run: async () => { ranAfterFailure = true; return { ok: true }; } }
  ], async (snapshot) => { state = JSON.parse(JSON.stringify(snapshot)); return { ok: true }; });
  check('failed transaction stops subsequent steps', !failure.ok && !ranAfterFailure);
  check('failed transaction restores the captured state', failure.rolledBack && state.taskbar === before.taskbar && state.theme === before.theme);
  check('transaction result contains no executable command surface', !JSON.stringify(failure).includes('command') && !JSON.stringify(failure).includes('exec'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
