'use strict';

// Exercise the profile folder path through shell/ipc.js without touching the
// user's registry or folders. The taskbar dependency is replaced with a
// deterministic in-memory fake, while the real transaction helper is used.

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

const beforeSnapshot = { hasDesktopIni: true, contentBase64: Buffer.from('before').toString('base64') };
const targetSnapshot = { hasDesktopIni: true, contentBase64: Buffer.from('target').toString('base64') };
let folderState = JSON.parse(JSON.stringify(beforeSnapshot));
let shellRestoreCalls = 0;
let journalEntry = null;
const handlers = {};
const fakeTaskbar = {
  hostKind: () => 'windows',
  getState: async () => ({ ok: true, marker: 'shell-state' }),
  listSpecialFolders: async () => ({ ok: true, folders: [{ id: 'Desktop', name: 'Desktop', path: 'C:\\Fake\\Desktop', exists: true }] }),
  readFolderCustomization: async () => Object.assign({ ok: true }, JSON.parse(JSON.stringify(folderState))),
  restoreFolderCustomization: async (_path, snapshot) => { folderState = JSON.parse(JSON.stringify(snapshot)); return { ok: true }; },
  restoreShellState: async () => { shellRestoreCalls++; return { ok: true }; },
  refreshThemeChange: async () => ({ ok: true })
};
const fakeJournal = {
  record: (_kind, before, after, meta) => { journalEntry = { id: 'profile-test', kind: 'profile-shell', before, after, meta }; return journalEntry; },
  latest: () => journalEntry,
  remove: (id) => { if (journalEntry && journalEntry.id === id) journalEntry = null; }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, dialog: {} };
  if (request === './taskbar' && parent && path.basename(parent.filename) === 'ipc.js') return fakeTaskbar;
  return originalLoad.call(this, request, parent, isMain);
};

(async function () {
  try {
    const shellIpc = require('../src/shell/ipc');
    const api = shellIpc.register({ journal: fakeJournal, getWindow: () => null, getConfig: () => ({ shell: {} }), saveConfig: () => {}, log: () => {} });
    const applied = await api.applyProfileShell({}, { Desktop: targetSnapshot });
    check('profile folder snapshot applies through the shell transaction', applied.ok && folderState.contentBase64 === targetSnapshot.contentBase64);
    check('profile journal captures shell and folder state', journalEntry && journalEntry.before && journalEntry.before.shell && journalEntry.before.folders.Desktop.contentBase64 === beforeSnapshot.contentBase64);
    const undone = await api.undo();
    check('profile undo restores the exact prior folder snapshot', undone.ok && folderState.contentBase64 === beforeSnapshot.contentBase64);
    check('profile undo restores the shell state and clears its journal entry', shellRestoreCalls === 1 && !journalEntry);
    check('shell channel registration remains present', typeof handlers['shell:undo'] === 'function' && typeof handlers['shell:folder:readCustomization'] === 'function');
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    failed++;
  } finally {
    Module._load = originalLoad;
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
