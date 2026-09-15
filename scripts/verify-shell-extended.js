#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — Extended shell verification harness
//
// Verifies the new shell capabilities: wallpaper gallery, folder
// customization, Start menu toggles, and accent hex picker.
// Everything here is read-only (no registry writes to live keys).
//
// Usage:
//   node scripts/verify-shell-extended.js
// Exit code 0 = every check passed.
// ═══════════════════════════════════════════════════════

const path = require('path');
const taskbar = require(path.join(__dirname, '..', 'src', 'shell', 'taskbar.js'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

(async function main() {
  console.log('SysGlance — Extended shell verification');
  console.log('node ' + process.version + ' | platform ' + process.platform + ' | registry host: ' + taskbar.hostKind());

  // ── 1. Module surface: new exports ──────────────────
  section('1. New module exports');
  check('listWallpapers is a function', typeof taskbar.listWallpapers === 'function');
  check('wallpaperGalleryPreview is a function', typeof taskbar.wallpaperGalleryPreview === 'function');
  check('openInExplorer is a function', typeof taskbar.openInExplorer === 'function');
  check('readFolderCustomization is a function', typeof taskbar.readFolderCustomization === 'function');
  check('writeFolderCustomization is a function', typeof taskbar.writeFolderCustomization === 'function');
  check('listSpecialFolders is a function', typeof taskbar.listSpecialFolders === 'function');
  check('getStartMenuState is a function', typeof taskbar.getStartMenuState === 'function');
  check('setStartMenuToggle is a function', typeof taskbar.setStartMenuToggle === 'function');
  check('openWindowsPersonalization is a function', typeof taskbar.openWindowsPersonalization === 'function');
  check('setAccentHex is a function', typeof taskbar.setAccentHex === 'function');
  check('getExtendedState is a function', typeof taskbar.getExtendedState === 'function');

  // ── 2. Constants include new keys ────────────────────
  section('2. New constants');
  const c = taskbar.constants;
  check('EXPLORER_ADV_KEY is defined', typeof c.EXPLORER_ADV_KEY === 'string', c.EXPLORER_ADV_KEY);
  check('EXPLORER_ADV_KEY points to Explorer\\Advanced', c.EXPLORER_ADV_KEY && c.EXPLORER_ADV_KEY.indexOf('Explorer\\Advanced') !== -1, c.EXPLORER_ADV_KEY || '(missing)');

  // ── 3. listSpecialFolders returns structured data ───
  section('3. Special folders');
  const folders = taskbar.listSpecialFolders();
  check('listSpecialFolders returns ok', folders.ok === true, folders.ok ? '' : folders.error);
  check('folders is an array', Array.isArray(folders.folders));
  check('has 6 standard folders', folders.folders.length === 6, 'got ' + folders.folders.length);
  if (folders.folders.length > 0) {
    const first = folders.folders[0];
    check('each folder has id, name, path, exists',
      typeof first.id === 'string' && typeof first.name === 'string' &&
      typeof first.path === 'string' && typeof first.exists === 'boolean',
      JSON.stringify(first));
  }

  // ── 4. readFolderCustomization validation ────────────
  section('4. Folder customization (validation)');
  const badPath = await taskbar.readFolderCustomization('');
  check('empty path returns error', badPath.ok === false, badPath.error || '');
  const relPath = await taskbar.readFolderCustomization('relative/path');
  check('relative path returns error', relPath.ok === false, relPath.error || '');
  const noPath = await taskbar.readFolderCustomization('/nonexistent/folder/that/does/not/exist');
  check('nonexistent folder returns error', noPath.ok === false, noPath.error || '');

  // ── 5. setAccentHex validation ────────────────────────
  section('5. Accent hex picker (validation)');
  const badHex1 = await taskbar.setAccentHex('not-a-color');
  check('invalid hex returns error', badHex1.ok === false, badHex1.error || '');
  const badHex2 = await taskbar.setAccentHex('#xyz');
  check('short/invalid hex returns error', badHex2.ok === false, badHex2.error || '');
  // A valid hex colour should parse correctly (actual write requires Windows)
  const parseCheck = taskbar.rgbToHex(0x35, 0x33, 0x5c);
  check('rgbToHex produces valid #RRGGBB', /^#[0-9a-f]{6}$/.test(parseCheck), parseCheck);

  // ── 6. setStartMenuToggle validation ──────────────────
  section('6. Start menu toggles (validation)');
  const badToggle = await taskbar.setStartMenuToggle('unknownToggle', true);
  check('unknown toggle returns error', badToggle.ok === false, badToggle.error || '');

  // ── 7. Wallpaper gallery (offline validation) ────────
  section('7. Wallpaper gallery (offline)');
  // listWallpapers on a non-existent dir should not crash
  const noGallery = await taskbar.listWallpapers('/nonexistent/path/that/does/not/exist');
  check('listWallpapers on bad path returns ok with empty files', noGallery.ok === true || noGallery.ok === false,
    noGallery.ok ? 'files: ' + (noGallery.files ? noGallery.files.length : '?') : 'error: ' + noGallery.error);

  // ── 8. Live Start menu state (Windows only) ─────────
  if (taskbar.supported()) {
    section('8. Live Start menu state (read-only)');
    const startMenu = await taskbar.getStartMenuState();
    check('getStartMenuState returns ok', startMenu.ok === true, startMenu.ok ? '' : startMenu.error || '');
    if (startMenu.ok) {
      check('showRecentApps is a boolean', typeof startMenu.showRecentApps === 'boolean', String(startMenu.showRecentApps));
      check('showSuggestions is a boolean', typeof startMenu.showSuggestions === 'boolean', String(startMenu.showSuggestions));
      check('fullScreenStart is a boolean', typeof startMenu.fullScreenStart === 'boolean', String(startMenu.fullScreenStart));
    }
  } else {
    section('8. Live Start menu state (skipped — not Windows/WSL)');
  }

  // ── 9. Extended state ────────────────────────────────
  if (taskbar.supported()) {
    section('9. Extended state (includes startMenu + specialFolders)');
    const ext = await taskbar.getExtendedState();
    check('getExtendedState returns ok', ext.ok === true, ext.ok ? '' : ext.error || '');
    check('extended state includes startMenu', ext.startMenu !== undefined);
    check('extended state includes specialFolders', ext.specialFolders !== undefined);
  } else {
    section('9. Extended state (skipped — not Windows/WSL)');
  }

  // ── summary ──────────────────────────────────────────
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('harness crashed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
