#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShellJournal } = require('../src/shell/journal');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sysglance-journal-'));
const file = path.join(root, 'shell-journal.json');
let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — shell journal verification');
const journal = new ShellJournal(file, 2);
const first = journal.record('shell', { theme: { dark: true } }, { theme: { dark: false } }, { action: 'theme' });
journal.record('folder', { iconResource: null }, { iconResource: 'C:\\icon.ico' }, { folderPath: 'C:\\Users\\Test\\Desktop' });
journal.record('start-menu', { showRecentApps: true }, { showRecentApps: false }, { name: 'showRecentApps' });
check('journal persists entries atomically', fs.existsSync(file));
check('journal remains bounded', journal.list().length === 2);
check('latest entry is readable', journal.latest() && journal.latest().kind === 'start-menu');
const reloaded = new ShellJournal(file, 2);
check('journal reloads after process restart', reloaded.list().length === 2);
check('remove deletes the selected entry', reloaded.remove(reloaded.latest().id) && reloaded.list().length === 1);
fs.writeFileSync(file, '{broken', 'utf8');
check('corrupt journal recovers empty', new ShellJournal(file, 2).list().length === 0);
check('journal does not contain executable commands', !JSON.stringify(journal.list()).includes('exec'));
try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
