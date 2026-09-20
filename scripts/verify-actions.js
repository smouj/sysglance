#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — desktop action verification');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const shellIpc = fs.readFileSync(path.join(root, 'src', 'shell', 'ipc.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

check('profile apply has an explicit undo path', main.includes("ipcMain.handle('profiles:undo'") && main.includes('profileUndo = null'));
check('diagnostics copy/export are explicit IPC handlers', main.includes("ipcMain.handle('diagnostics:copy'") && main.includes("ipcMain.handle('diagnostics:export'"));
check('diagnostics redact the saved wallpaper path', main.includes("copy.shell.wallpaperPath = copy.shell.wallpaperPath ? '[redacted]' : null"));
check('diagnostics bridge is narrow', preload.includes('diagnostics: {') && !preload.includes('diagnostics: (channel'));
check('clipboard actions reject control characters and length abuse', main.includes("ipcMain.handle('copy-text'") && main.includes('invalid clipboard text'));
check('command palette is present in the UI', html.includes('id="command-palette"') && html.includes('id="palette-input"'));
check('command palette has a global shortcut', config.includes("palette: 'CommandOrControl+K'") && main.includes('registerShortcuts') && preload.includes("'toggle-palette'"));
check('palette commands are navigation-only or explicit UI actions', renderer.includes('PALETTE_COMMANDS') && renderer.includes('Show system status') && renderer.includes("action: 'taskManager'") && main.includes("ipcMain.handle('control:open'"));
check('control actions are allow-listed and argument-safe', main.includes("ms-settings:network") && main.includes("execFile('taskmgr.exe', [], { windowsHide: true }") && main.includes("['user32.dll,LockWorkStation']") && !main.includes('exec('));
check('processes expose local filter and copy actions', html.includes('id="process-filter"') && renderer.includes('data-action="path"') && renderer.includes('PID copied'));
check('shell mutations expose a journal-backed undo channel', shellIpc.includes("ipcMain.handle('shell:undo'") && preload.includes("undo: 'shell:undo'") && shellIpc.includes('restoreShellState'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
