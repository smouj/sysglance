#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — settings validation harness
//
// Exercises src/config.js with no Electron and no dependencies: defaults,
// clamping, enum rejection, unknown-key dropping, prototype-pollution guards
// and an atomic save/load round trip in a scratch directory.
//
//   node scripts/verify-config.js      # exit 0 = every check passed
// ═══════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require(path.join(__dirname, '..', 'src', 'config.js'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

console.log('SysGlance — settings validation');
console.log('node ' + process.version + ' | platform ' + process.platform);

// ── 1. defaults ─────────────────────────────────────────
section('1. Defaults');
const d = config.defaults();
check('opacity default is 0.90', d.opacity === 0.9, String(d.opacity));
check('fast refresh default is 1500 ms', d.refreshInterval === 1500, String(d.refreshInterval));
check('hardware refresh default is inside 5–10 s', d.slowInterval >= 5000 && d.slowInterval <= 10000, d.slowInterval + ' ms');
check('every section key defaults to true', config.SECTION_KEYS.every((k) => d.showSections[k] === true), config.SECTION_KEYS.join(','));
check('shell defaults carry no resident-effect field',
  !('taskbarBlur' in d.shell) && !('resident' in d.shell), JSON.stringify(d.shell));
check('shortcut defaults are distinct and local', d.hotkeys && new Set(Object.values(d.hotkeys)).size === 3, JSON.stringify(d.hotkeys));

// ── 2. clamping and enums ───────────────────────────────
section('2. Clamping and enums');
const clamped = config.normalize({
  opacity: 5, refreshInterval: 1, slowInterval: 60000, fontSize: 99,
  theme: 'neon', layout: 'spiral', anchor: 'middle', compactMode: 'yes'
});
check('opacity is clamped to the 0.2–1 range', clamped.config.opacity === 1, String(clamped.config.opacity));
check('refreshInterval is clamped to 500 ms', clamped.config.refreshInterval === 500, String(clamped.config.refreshInterval));
check('slowInterval is clamped to 10 s', clamped.config.slowInterval === 10000, String(clamped.config.slowInterval));
check('fontSize is clamped to 16', clamped.config.fontSize === 16, String(clamped.config.fontSize));
check('an unknown theme falls back to dark', clamped.config.theme === 'dark', clamped.config.theme);
check('an unknown layout falls back to sidebar', clamped.config.layout === 'sidebar', clamped.config.layout);
check('an unknown anchor falls back to top-right', clamped.config.anchor === 'top-right', clamped.config.anchor);
check('a non-boolean compactMode falls back to false', clamped.config.compactMode === false, String(clamped.config.compactMode));
check('invalid values are reported, not silently swallowed', clamped.warnings.length >= 4, clamped.warnings.length + ' warnings');

// ── 3. hostile input ────────────────────────────────────
section('3. Hostile / corrupt input');
const polluted = config.normalize(JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"showSections":{"cpu":"yes","nope":true}}'));
check('__proto__ does not leak into the result', polluted.config.polluted === undefined);
check('Object.prototype stays clean', ({}).polluted === undefined);
check('a bad showSections value falls back to true', polluted.config.showSections.cpu === true, String(polluted.config.showSections.cpu));
check('unknown section keys are dropped', polluted.config.showSections.nope === undefined);
const unknown = config.normalize({ opacity: 0.5, totallyUnknown: 42, evil: 'x' });
check('unknown top-level keys are dropped', unknown.config.totallyUnknown === undefined && unknown.config.evil === undefined);
check('dropping is reported', unknown.warnings.some((w) => w.includes('totallyUnknown')), unknown.warnings.join(' | '));
check('normalize(null) returns usable defaults', config.normalize(null).config.refreshInterval === 1500);
check('normalize("string") returns usable defaults', config.normalize('nope').config.opacity === 0.9);

// ── 4. patch gate (what the renderer may write) ─────────
section('4. Renderer patch gate');
check('a writable key is accepted', config.validatePatch('refreshInterval', 2000).ok === true);
check('valid shortcut map is accepted', config.validatePatch('hotkeys', { toggle: 'CommandOrControl+Shift+S', lock: null, palette: 'CommandOrControl+K' }).ok === true);
check('duplicate shortcuts are refused', config.validatePatch('hotkeys', { toggle: 'CommandOrControl+K', lock: 'CommandOrControl+K', palette: 'CommandOrControl+P' }).ok === false);
check('a read-only key is refused', config.validatePatch('configVersion', 99).ok === false, config.validatePatch('configVersion', 99).reason);
check('an unknown key is refused', config.validatePatch('lastX', 10).ok === false, config.validatePatch('lastX', 10).reason);
check('a wrong type is refused', config.validatePatch('theme', 42).ok === false, config.validatePatch('theme', 42).reason);
check('a shell patch is normalized', config.validatePatch('shell', { taskbarPosition: 9, wallpaperPath: 'relative.png' }).value.taskbarPosition === null);
check('a non-absolute wallpaper path is refused', config.validatePatch('shell', { wallpaperPath: 'C:relative.png' }).value.wallpaperPath === null);

// ── 5. persistence round trip ───────────────────────────
section('5. Atomic persistence');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sysglance-verify-'));
const file = path.join(dir, 'config.json');
try {
  check('a missing file loads as defaults', config.load(file).config.refreshInterval === 1500);
  const written = config.save(file, { opacity: 0.55, layout: 'dock', refreshInterval: 99999 });
  check('save() normalizes before writing', written.opacity === 0.55 && written.refreshInterval === 5000, JSON.stringify({ opacity: written.opacity, refreshInterval: written.refreshInterval }));
  const reread = config.load(file);
  check('what was saved is what loads', reread.config.opacity === 0.55 && reread.config.layout === 'dock', JSON.stringify({ opacity: reread.config.opacity, layout: reread.config.layout }));
  check('no temp file is left behind', fs.readdirSync(dir).join(',') === 'config.json', fs.readdirSync(dir).join(','));
  fs.writeFileSync(file, '{ this is not json');
  const broken = config.load(file);
  check('a corrupt file recovers instead of throwing', broken.config.refreshInterval === 1500 && broken.recovered === true);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
