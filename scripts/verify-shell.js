#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — Shell verification harness
//
// Reads the real Windows state, proves the registry byte math is surgical and
// exercises the pure accent-math path. NO dependency beyond node itself.
//
// Everything here is read-only, EXCEPT one deliberately reversible test:
// a discardable key HKCU\Software\SysGlance\VerifyScratch is written and then
// deleted again. The taskbar position, auto-hide, theme, accent and wallpaper
// are never modified — that is why the byte math is tested through the pure
// applyPositionToBlob / applyAutoHideToBlob helpers instead of setPosition()
// / setAutoHide(), which do write to the live key.
//
// Usage:
//   node scripts/verify-shell.js
//   node scripts/verify-shell.js --pixels <raw-bgra-file> <width> <height>
//     -> averages an externally produced BGRA buffer (used to cross-check the
//        accent algorithm against PowerShell/System.Drawing on the real
//        wallpaper; see docs/SHELL.md)
// Exit code 0 = every check passed.
// ═══════════════════════════════════════════════════════

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const taskbar = require(path.join(__dirname, '..', 'src', 'shell', 'taskbar.js'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

function regExec(args) {
  return new Promise((resolve) => {
    execFile(taskbar.regExe(), args, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// BGRA pixels: [[r,g,b,a?], ...] -> Buffer, exactly what nativeImage.toBitmap() returns
function bgra(pixels) {
  const b = Buffer.alloc(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    b[i * 4] = p[2];
    b[i * 4 + 1] = p[1];
    b[i * 4 + 2] = p[0];
    b[i * 4 + 3] = p[3] === undefined ? 255 : p[3];
  }
  return b;
}

function diffBytes(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

(async function main() {
  console.log('SysGlance — Shell verification');
  console.log('node ' + process.version + ' | platform ' + process.platform + ' | registry host: ' + taskbar.hostKind());

  // ── 1. module surface ─────────────────────────────────
  section('1. Module load');
  check('taskbar.js loads via require()', typeof taskbar.getState === 'function');
  check('exports the documented API', [
    'getTaskbarState', 'setPosition', 'setAutoHide', 'restartExplorer',
    'getTheme', 'setDark', 'getAccent', 'setAccent', 'averageAccentRgb',
    'extractAccentFromWallpaper', 'getWallpaper', 'applyWallpaper', 'refreshThemeChange', 'restoreShellState'
  ].every((k) => typeof taskbar[k] === 'function'));

  if (!taskbar.supported()) {
    console.log('\nRegistry access unavailable on this platform — live checks skipped.');
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail === 0 ? 0 : 1);
  }

  // ── 2. live state (read-only) ─────────────────────────
  section('2. Live taskbar state (read-only)');
  const raw = await taskbar._internal.readBinary(taskbar.constants.STUCK_KEY, taskbar.constants.STUCK_VALUE);
  check('StuckRects3\\Settings is readable', raw.ok, raw.ok ? raw.buffer.length + ' bytes' : raw.error);

  const st = await taskbar.getTaskbarState();
  if (st.ok) {
    console.log('    byte[12]=' + st.positionIndex + ' (' + st.position + ')  byte[8]=0x' +
      st.autoHideByte.toString(16) + '  autoHide=' + st.autoHide);
    check('position byte is a valid dock edge (0..3)', st.positionIndex >= 0 && st.positionIndex <= 3, 'got ' + st.positionIndex);
    check('autoHide is a boolean', typeof st.autoHide === 'boolean');
  } else {
    check('taskbar state read', false, st.error);
  }

  // ── 3. surgical byte math (pure, nothing written) ─────
  section('3. Byte-precision edits (in memory — the live key is never written)');
  if (raw.ok) {
    const real = raw.buffer;
    const forLeft = taskbar.applyPositionToBlob(real, 0);
    const posDiff = diffBytes(real, forLeft);
    check('setPosition changes exactly one byte', posDiff.length === 1 && posDiff[0] === taskbar.constants.POSITION_BYTE,
      'changed byte offset(s): ' + JSON.stringify(posDiff));
    check('position edit writes the requested value', forLeft[taskbar.constants.POSITION_BYTE] === 0);
    check('position edit keeps the original blob length', forLeft.length === real.length);

    const hidOn = taskbar.applyAutoHideToBlob(real, true);
    const hidOnDiff = diffBytes(real, hidOn);
    check('setAutoHide(on) touches only byte ' + taskbar.constants.AUTOHIDE_BYTE,
      hidOnDiff.length <= 1 && (hidOnDiff.length === 0 || hidOnDiff[0] === taskbar.constants.AUTOHIDE_BYTE),
      'changed: ' + JSON.stringify(hidOnDiff));
    check('setAutoHide(on) sets bit 0 and keeps the other flags in that byte',
      (hidOn[8] & 0x01) === 1, 'byte[8] 0x' + real[8].toString(16) + ' -> 0x' + hidOn[8].toString(16));
    // State-independent on purpose: auto-hide may already be ON in the live key
    // (the panel writes that bit for real), so "off" is compared against the
    // canonical off-blob rather than against whatever the key happens to hold.
    // An earlier version of this check asserted `off == live`, which passed only
    // while the user's auto-hide happened to be disabled.
    const canonicalOff = taskbar.applyAutoHideToBlob(real, false);
    check('setAutoHide(off) clears bit 0 and keeps the other flags in that byte',
      (canonicalOff[8] & 0x01) === 0 && (canonicalOff[8] & 0xFE) === (real[8] & 0xFE),
      'byte[8] 0x' + real[8].toString(16) + ' -> 0x' + canonicalOff[8].toString(16));
    check('setAutoHide is idempotent (on then off equals plain off)',
      taskbar.applyAutoHideToBlob(hidOn, false).equals(canonicalOff));
    check('setAutoHide(off) is a no-op when bit 0 is already clear',
      taskbar.applyAutoHideToBlob(canonicalOff, false).equals(canonicalOff));
  }

  // ── 4. reversible registry write (scratch key) ────────
  section('4. REG_BINARY write path (scratch key, deleted afterwards)');
  const SCRATCH_KEY = 'HKCU\\Software\\SysGlance\\VerifyScratch';
  const SCRATCH_VALUE = 'Blob';
  if (raw.ok) {
    const sample = taskbar.applyPositionToBlob(raw.buffer, 0);
    const w = await taskbar._internal.writeBinary(SCRATCH_KEY, SCRATCH_VALUE, sample);
    check('writeBinary reports success', w.ok, w.error || '');
    const back = await taskbar._internal.readBinary(SCRATCH_KEY, SCRATCH_VALUE);
    check('read-back matches byte for byte',
      back.ok && back.hex === sample.toString('hex').toUpperCase(),
      back.ok ? back.buffer.length + ' bytes, identical=' + (back.hex === sample.toString('hex').toUpperCase()) : back.error);
    const del = await regExec(['delete', SCRATCH_KEY, '/f']);
    check('scratch key deleted', del.ok, del.ok ? SCRATCH_KEY : (del.stderr || '').trim());
    const after = await taskbar._internal.readBinary(SCRATCH_KEY, SCRATCH_VALUE);
    check('scratch key really gone', after.ok === false);
  }

  // ── 5. accent math (pure) ─────────────────────────────
  section('5. Accent sampling math (pure — synthetic BGRA buffers)');
  const mixed = taskbar.averageAccentRgb(bgra([
    [255, 0, 0], [0, 0, 255], [128, 128, 128], [10, 10, 10], [255, 255, 255]
  ]), 5, 1);
  check('saturated blue survives the filter (the luma trap)', mixed.ok && mixed.kept === 2,
    'kept=' + mixed.kept + ' sampled=' + mixed.sampled);
  check('red + blue average to #800080', mixed.ok && mixed.hex === '#800080', 'got ' + (mixed.ok ? mixed.hex : mixed.error));

  const greys = taskbar.averageAccentRgb(bgra([[128, 128, 128], [200, 200, 200]]), 2, 1);
  check('grey-only image falls back to the plain average', greys.ok && greys.hex === '#a4a4a4', 'got ' + (greys.ok ? greys.hex : greys.error));

  const transparent = taskbar.averageAccentRgb(bgra([[255, 0, 0, 0], [0, 255, 0, 10]]), 2, 1);
  check('fully transparent buffer is rejected', transparent.ok === false, transparent.error || '');

  const solid = taskbar.averageAccentRgb(bgra([[0x35, 0x33, 0x5c]]), 1, 1);
  check('single dark-blue pixel round-trips', solid.ok && solid.hex === '#35335c', 'got ' + (solid.ok ? solid.hex : solid.error));

  // ── 6. colour codecs against the live registry values ─
  section('6. Accent colour codecs');
  const liveAccent = await taskbar.getAccent();
  if (liveAccent.ok && liveAccent.accentColorRaw != null) {
    const decoded = taskbar.decodeAbgr(liveAccent.accentColorRaw);
    check('AccentColor decodes as ABGR (0xAABBGGRR)',
      taskbar.encodeAbgr(decoded) === liveAccent.accentColorRaw,
      '0x' + liveAccent.accentColorRaw.toString(16) + ' -> r' + decoded.r + ' g' + decoded.g + ' b' + decoded.b);
    check('ABGR and ARGB of the same colour agree on RGB',
      liveAccent.colorizationRgb &&
      decoded.r === liveAccent.colorizationRgb.r &&
      decoded.g === liveAccent.colorizationRgb.g &&
      decoded.b === liveAccent.colorizationRgb.b,
      'hex ' + liveAccent.hex);
  }
  check('encodeAbgr(0x35335c) === 0xff5c3335', taskbar.encodeAbgr({ r: 0x35, g: 0x33, b: 0x5c }) === 0xff5c3335);
  check('encodeArgb(0x35335c) === 0xff35335c', taskbar.encodeArgb({ r: 0x35, g: 0x33, b: 0x5c }) === 0xff35335c);
  check('rgbToHex pads correctly', taskbar.rgbToHex(0, 1, 255) === '#0001ff');

  // ── 7. restart plan (dry run, nothing executed) ───────
  section('7. restartExplorer() plan (dry run)');
  const plan = await taskbar.restartExplorer({ dryRun: true });
  check('dry run returns the exact commands without executing them',
    plan.ok && plan.dryRun && plan.commands.length === 2, plan.commands.join(' ; '));

  // ── 8. optional external BGRA cross-check ─────────────
  const pxIdx = process.argv.indexOf('--pixels');
  if (pxIdx !== -1) {
    section('8. Accent average of an externally produced BGRA buffer');
    const file = process.argv[pxIdx + 1];
    const w = parseInt(process.argv[pxIdx + 2], 10);
    const h = parseInt(process.argv[pxIdx + 3], 10);
    if (fs.existsSync(file) && w > 0 && h > 0) {
      const buf = fs.readFileSync(file);
      const res = taskbar.averageAccentRgb(buf, w, h);
      console.log('    buffer ' + buf.length + ' bytes (' + w + 'x' + h + '), result: ' + JSON.stringify(res));
      check('external buffer analysed', res.ok === true, res.ok ? res.hex : res.error);
    } else {
      check('--pixels arguments valid', false, 'missing file or dimensions');
    }
  }

  // ── summary ───────────────────────────────────────────
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('harness crashed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
