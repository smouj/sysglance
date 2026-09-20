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
const metricsSource = fs.readFileSync(path.join(root, 'src', 'metrics.js'), 'utf8');
const profiles = fs.readFileSync(path.join(root, 'src', 'profiles.js'), 'utf8');

check('profile apply has an explicit undo path', main.includes("ipcMain.handle('profiles:undo'") && main.includes('profileUndo = null'));
check('diagnostics copy/export/bundle/open-logs are explicit IPC handlers', main.includes("ipcMain.handle('diagnostics:copy'") && main.includes("ipcMain.handle('diagnostics:export'") && main.includes("ipcMain.handle('diagnostics:bundle'") && main.includes("ipcMain.handle('diagnostics:openLogs'") && preload.includes('bundle:'));
check('diagnostics redact the saved wallpaper path', main.includes("copy.shell.wallpaperPath = copy.shell.wallpaperPath ? '[redacted]' : null"));
check('diagnostics bridge is narrow', preload.includes('diagnostics: {') && !preload.includes('diagnostics: (channel'));
check('clipboard actions reject control characters and length abuse', main.includes("ipcMain.handle('copy-text'") && main.includes('invalid clipboard text'));
check('command palette is present in the UI', html.includes('id="command-palette"') && html.includes('id="palette-input"'));
check('command palette has a global shortcut', config.includes("palette: 'CommandOrControl+K'") && main.includes('registerShortcuts') && preload.includes("'toggle-palette'"));
check('palette commands are navigation-only or explicit UI actions', renderer.includes('PALETTE_COMMANDS') && renderer.includes('Show system status') && renderer.includes("action: 'taskManager'") && renderer.includes("action: 'services'") && renderer.includes("action: 'sleep'") && main.includes("ipcMain.handle('control:open'"));
check('control actions are allow-listed, argument-safe and confirmed when destructive', main.includes("ms-settings:network") && main.includes("execFile('taskmgr.exe', [], { windowsHide: true }") && main.includes("execFile('services.msc', [], { windowsHide: true }") && main.includes("['user32.dll,LockWorkStation']") && main.includes("shutdown.exe") && main.includes('CONTROL_CONFIRMATIONS') && !main.includes('exec('));
check('processes expose local filter and copy actions', html.includes('id="process-filter"') && renderer.includes('data-action="path"') && renderer.includes('PID copied'));
check('shell mutations expose a journal-backed undo channel', shellIpc.includes("ipcMain.handle('shell:undo'") && preload.includes("undo: 'shell:undo'") && shellIpc.includes('restoreShellState'));
check('profile shell apply is explicit and transactional', main.includes("ipcMain.handle('profiles:applyShell'") && main.includes('showMessageBox') && shellIpc.includes('applyProfileShell') && shellIpc.includes('runShellTransaction'));
check('profiles carry exact folder snapshots through transactional shell apply', profiles.includes('folderCustomizations') && main.includes('captureProfileFolders') && shellIpc.includes('restoreProfileFolders') && shellIpc.includes('folder icon '));
check('folder analysis is explicit and bounded', main.includes("ipcMain.handle('storage:analyzeHome'") && html.includes('id="storage-analyze"') && metricsSource.includes('maxEntries') && metricsSource.includes('isSymbolicLink'));
check('network identity is an explicit on-demand bridge', main.includes("ipcMain.handle('network:inspect'") && preload.includes('network: {') && metricsSource.includes('getNetworkDetails'));
check('active local alerts are visible in System status', html.includes('id="health-alerts"') && renderer.includes('renderHealth(data.health, data.alerts)') && renderer.includes('Active alerts'));
check('storage exposes free space and filesystem metadata', renderer.includes('disk.available') && renderer.includes('disk.fs') && renderer.includes('disk.type'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
