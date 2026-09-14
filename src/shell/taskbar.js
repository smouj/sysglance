'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — Shell: taskbar / theme / accent / wallpaper
// Configures the Windows shell using only APIs that ship with Windows.
// No npm deps.
//
// SCOPE (see PRODUCT.md): position, auto-hide, dark mode, accent and wallpaper
// only. Taskbar *vibrancy* is not here on purpose — the resident effect is
// owned by OpenClaw Widget, and two processes applying window policy to the
// same taskbar would fight.
//
// ── Registry access method (chosen, do not swap lightly) ─────
// We shell out to the in-box `reg.exe` through child_process.execFile
// with an *argument array* (never a shell string, so there is no
// quoting/injection surface). Rationale:
//   * `regedit` / `ffi-napi` / `koffi` / `node-reg` are npm
//     dependencies — this project forbids new ones.
//   * reg.exe is present on every Windows 10 install and its stdout is
//     trivially parseable:
//       read : reg query KEY /v NAME
//              -> "    Settings    REG_BINARY    30000000FEFFFFFF..."
//       write: reg add KEY /v NAME /t REG_BINARY /d <hex> /f
//   * The binary blob is edited with Buffer, so every byte we do not
//     intend to touch is written back verbatim (reversible edits).
// Under WSL (development + verification only) the same Windows binary is
// reachable through the interop mount, so this module can read/write the
// *real* Windows registry from a WSL shell. On Windows it is plain
// `reg.exe`. Override with SYSGLANCE_REG_EXE if needed.
//
// ── Verified semantics (Windows 10 Pro 22H2, build 19045) ────
// Taskbar geometry lives in one REG_BINARY value:
//   HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3
//   value "Settings" (48 bytes on this build)
//     byte[12] = dock edge      0 = left, 1 = top, 2 = right, 3 = bottom
//     byte[ 8] bit 0 (0x01)     taskbar auto-hide on/off
// Explorer caches these in memory, so a position/auto-hide change only
// takes effect after explorer.exe restarts -> restartExplorer().
//
// Accent colours (two different byte orders, easy to get wrong):
//   HKCU\Software\Microsoft\Windows\DWM\AccentColor        0xAABBGGRR (ABGR)
//   HKCU\Software\Microsoft\Windows\DWM\ColorizationColor   0xAARRGGBB (ARGB)
//   HKCU\...\DWM\AutoColorization                          1 = let Windows derive
//   HKCU\...\Themes\Personalize\ColorPrevalence            1 = accents on taskbar
//
// Wallpaper (the actual repaint needs SystemParametersInfo, not registry):
//   HKCU\Control Panel\Desktop\Wallpaper        REG_SZ  full path
//   HKCU\Control Panel\Desktop\WallpaperStyle   REG_SZ  "10" = fill
//   HKCU\Control Panel\Desktop\TileWallpaper    REG_SZ  "0"
//   then SystemParametersInfo(SPI_SETDESKWALLPAPER=20, 0, path, 3) — this is
//   done by our own C# helper (`--wallpaper=<path>`), which is why it exists;
//   no npm dependency and no PowerShell/rundll32 shim is involved.
//   The helper is compiled once with scripts/build-native.ps1 and is NOT
//   committed (binaries do not belong in git); a missing helper degrades the
//   wallpaper step to "registry written, repaint on next logon".
//
// Accent-from-wallpaper: Electron's nativeImage decodes the image, we
// downscale to 64 px and average the pixels that look like a usable accent
// (skip near-black, blown-out and grey pixels). Pure math on a BGRA buffer,
// so it is unit-testable without a display (see scripts/verify-shell.js).
// ═══════════════════════════════════════════════════════

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const helper = require('../native/shellHelper');

const TAG = '[shell/taskbar]';

// ── Registry plumbing ────────────────────────────────────
const IS_WINDOWS = process.platform === 'win32';
const WSL_REG = '/mnt/c/Windows/System32/reg.exe';

function regExe() {
  if (process.env.SYSGLANCE_REG_EXE) return process.env.SYSGLANCE_REG_EXE;
  return IS_WINDOWS ? 'reg.exe' : WSL_REG;
}

function hostKind() {
  if (IS_WINDOWS) return 'windows';
  try { if (fs.existsSync(WSL_REG)) return 'wsl'; } catch (_) {}
  return 'unsupported';
}

function supported() { return hostKind() !== 'unsupported'; }

function runReg(args, timeoutMs) {
  return new Promise((resolve) => {
    if (!supported()) return resolve({ ok: false, error: 'registry access unavailable on ' + process.platform });
    execFile(regExe(), args, { windowsHide: true, timeout: timeoutMs || 8000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// Parses `reg query KEY /v NAME` stdout -> { type, value } | null
function parseQueryLine(stdout) {
  const lines = String(stdout).split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s{2,}(\S.*?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(line);
    if (m) return { name: m[1].trim(), type: m[2], value: m[3].trim() };
  }
  return null;
}

async function queryValue(key, name) {
  const res = await runReg(['query', key, '/v', name]);
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout).trim() || 'value not found', code: res.code };
  const parsed = parseQueryLine(res.stdout);
  if (!parsed) return { ok: false, error: 'unparsable reg output' };
  return { ok: true, type: parsed.type, value: parsed.value };
}

async function queryDword(key, name) {
  const v = await queryValue(key, name);
  if (!v.ok) return v;
  const raw = v.value.trim();
  const num = /^0x/i.test(raw) ? parseInt(raw.slice(2), 16) : parseInt(raw, 10);
  if (!Number.isFinite(num)) return { ok: false, error: 'not a DWORD: ' + raw };
  // reg.exe prints DWORDs unsigned; normalise to unsigned 32-bit
  return { ok: true, value: num >>> 0, raw };
}

async function writeDword(key, name, value) {
  const res = await runReg(['add', key, '/v', name, '/t', 'REG_DWORD', '/d', String(value >>> 0), '/f']);
  return { ok: res.ok, error: res.ok ? null : (res.stderr || res.stdout).trim() };
}

async function writeString(key, name, value) {
  const res = await runReg(['add', key, '/v', name, '/t', 'REG_SZ', '/d', String(value), '/f']);
  return { ok: res.ok, error: res.ok ? null : (res.stderr || res.stdout).trim() };
}

async function readBinary(key, name) {
  const v = await queryValue(key, name);
  if (!v.ok) return v;
  const hex = v.value.replace(/[\s,]/g, '');
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return { ok: false, error: 'not a binary blob' };
  return { ok: true, hex: hex.toUpperCase(), buffer: Buffer.from(hex, 'hex') };
}

async function writeBinary(key, name, buffer) {
  const res = await runReg(['add', key, '/v', name, '/t', 'REG_BINARY', '/d', buffer.toString('hex'), '/f']);
  return { ok: res.ok, error: res.ok ? null : (res.stderr || res.stdout).trim() };
}

// ── Taskbar geometry (StuckRects3) ───────────────────────
const STUCK_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects3';
const STUCK_VALUE = 'Settings';
const POSITION_BYTE = 12;
const AUTOHIDE_BYTE = 8;
const AUTOHIDE_BIT = 0x01;
const POSITION_NAMES = ['left', 'top', 'right', 'bottom'];

// Set by any write that explorer.exe has not picked up yet.
let pendingRestart = false;

function positionName(index) {
  return POSITION_NAMES[index] !== undefined ? POSITION_NAMES[index] : 'unknown(' + index + ')';
}

function positionIndex(pos) {
  if (typeof pos === 'number') return Number.isInteger(pos) && pos >= 0 && pos <= 3 ? pos : null;
  const i = POSITION_NAMES.indexOf(String(pos || '').toLowerCase());
  return i === -1 ? null : i;
}

// Pure byte math, exported so scripts/verify-shell.js can prove that an edit
// touches only the intended byte(s) without writing to the real taskbar key.
function applyPositionToBlob(buffer, index) {
  const buf = Buffer.from(buffer);
  buf[POSITION_BYTE] = index;
  return buf;
}

function applyAutoHideToBlob(buffer, on) {
  const buf = Buffer.from(buffer);
  buf[AUTOHIDE_BYTE] = on ? (buf[AUTOHIDE_BYTE] | AUTOHIDE_BIT) : (buf[AUTOHIDE_BYTE] & ~AUTOHIDE_BIT);
  return buf;
}

async function readTaskbarRaw() {
  const r = await readBinary(STUCK_KEY, STUCK_VALUE);
  if (!r.ok) return r;
  if (r.buffer.length <= POSITION_BYTE) return { ok: false, error: 'StuckRects3 blob too short (' + r.buffer.length + ' bytes)' };
  return r;
}

/** Public, JSON-safe taskbar state. Read-only. */
async function getTaskbarState() {
  const raw = await readTaskbarRaw();
  if (!raw.ok) return { ok: false, error: raw.error };
  const buf = raw.buffer;
  return {
    ok: true,
    key: STUCK_KEY,
    size: buf.length,
    hex: raw.hex,
    positionIndex: buf[POSITION_BYTE],
    position: positionName(buf[POSITION_BYTE]),
    autoHide: (buf[AUTOHIDE_BYTE] & AUTOHIDE_BIT) !== 0,
    autoHideByte: buf[AUTOHIDE_BYTE],
    restartRequired: pendingRestart
  };
}

/**
 * Move the taskbar dock edge. `pos` = 'left'|'top'|'right'|'bottom' | 0..3.
 * Only byte[12] is modified; the rest of the blob is written back verbatim.
 */
async function setPosition(pos) {
  const index = positionIndex(pos);
  if (index === null) return { ok: false, error: 'invalid position: ' + pos };
  const raw = await readTaskbarRaw();
  if (!raw.ok) return raw;
  const before = raw.buffer[POSITION_BYTE];
  if (before === index) {
    return { ok: true, changed: false, positionIndex: index, position: positionName(index), restartRequired: pendingRestart };
  }
  const buf = applyPositionToBlob(raw.buffer, index);
  const written = await writeBinary(STUCK_KEY, STUCK_VALUE, buf);
  if (!written.ok) return { ok: false, error: written.error };
  pendingRestart = true;
  console.warn(TAG, 'taskbar position ' + positionName(before) + ' -> ' + positionName(index) +
    ': explorer.exe must be restarted for this to take effect (restartExplorer()).');
  return { ok: true, changed: true, from: positionName(before), positionIndex: index, position: positionName(index), restartRequired: true };
}

/**
 * Toggle taskbar auto-hide. Only bit 0 of byte[8] is modified, so the other
 * sticky-rect flags in that byte survive.
 */
async function setAutoHide(enabled) {
  const on = !!enabled;
  const raw = await readTaskbarRaw();
  if (!raw.ok) return raw;
  const current = (raw.buffer[AUTOHIDE_BYTE] & AUTOHIDE_BIT) !== 0;
  if (current === on) {
    return { ok: true, changed: false, autoHide: on, restartRequired: pendingRestart };
  }
  const buf = applyAutoHideToBlob(raw.buffer, on);
  const written = await writeBinary(STUCK_KEY, STUCK_VALUE, buf);
  if (!written.ok) return { ok: false, error: written.error };
  pendingRestart = true;
  console.warn(TAG, 'taskbar auto-hide ' + (current ? 'on' : 'off') + ' -> ' + (on ? 'on' : 'off') +
    ': explorer.exe must be restarted for this to take effect (restartExplorer()).');
  return { ok: true, changed: true, autoHide: on, restartRequired: true };
}

/**
 * Kill and relaunch explorer.exe so StuckRects changes are adopted.
 * explorer.exe does not survive taskkill gracefully by design; Windows
 * respawns it automatically, but we start it explicitly to be deterministic.
 * Set SYSGLANCE_DRY_RUN=1 (or pass {dryRun:true}) to get the exact command
 * list without executing anything.
 */
function restartExplorer(opts) {
  const o = opts || {};
  const dry = o.dryRun === true || process.env.SYSGLANCE_DRY_RUN === '1';
  const killExe = IS_WINDOWS ? 'taskkill.exe' : '/mnt/c/Windows/System32/taskkill.exe';
  const explorerExe = IS_WINDOWS ? 'explorer.exe' : '/mnt/c/Windows/explorer.exe';
  const plan = [
    { file: killExe, args: ['/f', '/im', 'explorer.exe'] },
    { file: explorerExe, args: [] }
  ];
  if (dry) return Promise.resolve({ ok: true, dryRun: true, commands: plan.map(c => c.file + ' ' + c.args.join(' ')) });

  return new Promise((resolve) => {
    execFile(killExe, ['/f', '/im', 'explorer.exe'], { windowsHide: true, timeout: 10000 }, (err) => {
      // taskkill returns !=0 if explorer was not running; we still relaunch.
      const killed = !err;
      try {
        const child = require('child_process').spawn(explorerExe, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
      } catch (e) {
        return resolve({ ok: false, killed, error: 'could not relaunch explorer: ' + e.message });
      }
      pendingRestart = false;
      console.log(TAG, 'explorer.exe restarted — taskbar changes are now in effect.');
      resolve({ ok: true, killed, relaunched: true });
    });
  });
}

// ── Dark / light mode ────────────────────────────────────
const PERSONALIZE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

async function getTheme() {
  const apps = await queryDword(PERSONALIZE_KEY, 'AppsUseLightTheme');
  const sys = await queryDword(PERSONALIZE_KEY, 'SystemUsesLightTheme');
  const prevalence = await queryDword(PERSONALIZE_KEY, 'ColorPrevalence');
  if (!apps.ok && !sys.ok) return { ok: false, error: apps.error || sys.error };
  return {
    ok: true,
    appsUseLightTheme: apps.ok ? apps.value : null,
    systemUsesLightTheme: sys.ok ? sys.value : null,
    colorPrevalence: prevalence.ok ? prevalence.value : null,
    dark: apps.ok ? apps.value === 0 : null
  };
}

/**
 * Dark mode = both AppsUseLightTheme and SystemUsesLightTheme set to 0.
 * Windows caches this per-process, so a full repaint needs a re-login or an
 * explorer restart; `refreshThemeChange()` (helper --refresh-theme) nudges
 * already-running apps that listen for the broadcast.
 */
async function setDark(enabled) {
  const on = !!enabled;
  const apps = await writeDword(PERSONALIZE_KEY, 'AppsUseLightTheme', on ? 0 : 1);
  const sys = await writeDword(PERSONALIZE_KEY, 'SystemUsesLightTheme', on ? 0 : 1);
  if (!apps.ok || !sys.ok) return { ok: false, error: apps.error || sys.error };
  return { ok: true, dark: on, note: 'already-running apps may need re-login or an explorer restart to repaint' };
}

// ── Accent colour ────────────────────────────────────────
const DWM_KEY = 'HKCU\\Software\\Microsoft\\Windows\\DWM';

function toHexByte(n) { return ('0' + (n & 0xff).toString(16)).slice(-2); }
function rgbToHex(r, g, b) { return '#' + toHexByte(r) + toHexByte(g) + toHexByte(b); }

// 0xAABBGGRR -> {r,g,b}
function decodeAbgr(dword) {
  return { a: (dword >>> 24) & 0xff, r: dword & 0xff, g: (dword >>> 8) & 0xff, b: (dword >>> 16) & 0xff };
}
// 0xAARRGGBB -> {r,g,b}
function decodeArgb(dword) {
  return { a: (dword >>> 24) & 0xff, r: (dword >>> 16) & 0xff, g: (dword >>> 8) & 0xff, b: dword & 0xff };
}
function encodeAbgr(c) { return (((c.a === undefined ? 0xff : c.a) << 24) | ((c.b & 0xff) << 16) | ((c.g & 0xff) << 8) | (c.r & 0xff)) >>> 0; }
function encodeArgb(c) { return (((c.a === undefined ? 0xff : c.a) << 24) | ((c.r & 0xff) << 16) | ((c.g & 0xff) << 8) | (c.b & 0xff)) >>> 0; }

async function getAccent() {
  const accent = await queryDword(DWM_KEY, 'AccentColor');
  const colorization = await queryDword(DWM_KEY, 'ColorizationColor');
  const auto = await queryDword(DWM_KEY, 'AutoColorization');
  const prevalence = await queryDword(PERSONALIZE_KEY, 'ColorPrevalence');
  const a = accent.ok ? decodeAbgr(accent.value) : null;
  const c = colorization.ok ? decodeArgb(colorization.value) : null;
  return {
    ok: !!(a || c),
    accentColorRaw: accent.ok ? accent.value >>> 0 : null,
    colorizationColorRaw: colorization.ok ? colorization.value >>> 0 : null,
    accentRgb: a ? { r: a.r, g: a.g, b: a.b } : null,
    colorizationRgb: c ? { r: c.r, g: c.g, b: c.b } : null,
    hex: a ? rgbToHex(a.r, a.g, a.b) : (c ? rgbToHex(c.r, c.g, c.b) : null),
    autoColorization: auto.ok ? auto.value : null,
    colorPrevalence: prevalence.ok ? prevalence.value : null
  };
}

/**
 * Write an accent colour.
 *   color  {r,g,b}  explicit colour; when omitted Windows' AutoColorization
 *                   (derive from wallpaper) is left in charge.
 *   auto   true     -> AutoColorization=1 (Windows derives; our colour, if
 *                      given, is still written so the value is deterministic)
 *          false    -> AutoColorization=0 (pin the explicit colour)
 * ColorPrevalence=1 is always set so the accent actually shows on the taskbar.
 */
async function setAccent(color, options) {
  const o = options || {};
  const auto = o.auto !== false;
  const results = [];
  if (color) {
    const abgr = encodeAbgr(color);
    const argb = encodeArgb(color);
    results.push(await writeDword(DWM_KEY, 'AccentColor', abgr));
    results.push(await writeDword(DWM_KEY, 'ColorizationColor', argb));
  }
  results.push(await writeDword(DWM_KEY, 'AutoColorization', auto ? 1 : 0));
  results.push(await writeDword(PERSONALIZE_KEY, 'ColorPrevalence', 1));
  const failed = results.find(r => !r.ok);
  if (failed) return { ok: false, error: failed.error };
  return {
    ok: true,
    autoColorization: auto ? 1 : 0,
    colorPrevalence: 1,
    wrote: (color ? ['AccentColor(ABGR)', 'ColorizationColor(ARGB)'] : []).concat(['AutoColorization', 'Personalize\\ColorPrevalence']),
    note: 'DWM repaints on new windows immediately; existing frames may need refreshThemeChange()'
  };
}

/**
 * Average a BGRA bitmap down to one usable accent colour.
 * Exported because it is the only non-trivial pure logic in the accent path
 * and is exercised directly by scripts/verify-shell.js.
 *
 * Kept pixels: opaque, and
 *   value       = max(R,G,B)/255              >= 0.12   (drop near-black)
 *   saturation  = (max-min)/max               >= 0.15   (drop greys)
 *   not (value  >= 0.95 and saturation < 0.2)           (drop blown-out white)
 * Value/saturation is used instead of luma on purpose: a saturated blue has a
 * luma of 0.07 and would be discarded as "black", yet it is a perfectly good
 * accent colour. Falls back to the plain average of every opaque pixel when
 * nothing survives the filter.
 */
function averageAccentRgb(buffer, width, height) {
  let r = 0, g = 0, b = 0, n = 0;
  let allR = 0, allG = 0, allB = 0, allN = 0;
  for (let i = 0; i + 3 < buffer.length; i += 4) {
    const B = buffer[i], G = buffer[i + 1], R = buffer[i + 2], A = buffer[i + 3];
    if (A < 128) continue;                       // transparent
    allR += R; allG += G; allB += B; allN++;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const value = max / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (value < 0.12) continue;                  // near-black
    if (sat < 0.15) continue;                    // grey (also catches pure white)
    if (value >= 0.95 && sat < 0.2) continue;    // blown-out white
    r += R; g += G; b += B; n++;
  }
  if (n === 0 && allN > 0) { r = allR; g = allG; b = allB; n = allN; }
  if (n === 0) return { ok: false, error: 'no opaque pixels' };
  const out = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  return { ok: true, r: out.r, g: out.g, b: out.b, hex: rgbToHex(out.r, out.g, out.b), kept: n, sampled: allN, width, height };
}

// nativeImage is required lazily: that keeps this module loadable (and its
// registry half testable) outside Electron, e.g. `node -e require(...)`.
function loadNativeImage() {
  try {
    const electron = require('electron');
    return (electron && electron.nativeImage) || null;
  } catch (_) {
    return null;
  }
}

const MAX_SAMPLE_DIM = 64;

/** {ok, r,g,b,hex,kept,sampled} for a wallpaper file, via Electron's decoder. */
function extractAccentFromWallpaper(filePath) {
  if (!filePath) return { ok: false, error: 'no wallpaper path' };
  let exists = false;
  try { exists = fs.existsSync(filePath); } catch (_) {}
  if (!exists) return { ok: false, error: 'wallpaper not found: ' + filePath };
  const nativeImage = loadNativeImage();
  if (!nativeImage) return { ok: false, error: 'electron nativeImage unavailable (must run inside Electron)' };
  let img = null;
  try { img = nativeImage.createFromPath(filePath); } catch (e) { return { ok: false, error: 'decode failed: ' + e.message }; }
  if (!img || img.isEmpty()) return { ok: false, error: 'could not decode image: ' + filePath };
  const size = img.getSize();
  const scale = MAX_SAMPLE_DIM / Math.max(size.width, size.height);
  const w = Math.max(1, Math.round(size.width * scale));
  const h = Math.max(1, Math.round(size.height * scale));
  const small = (w !== size.width || h !== size.height) ? img.resize({ width: w, height: h, quality: 'good' }) : img;
  const sSize = small.getSize();
  const bitmap = small.toBitmap(); // BGRA, tightly packed
  const res = averageAccentRgb(bitmap, sSize.width, sSize.height);
  if (!res.ok) return res;
  return Object.assign(res, { source: filePath, sourceSize: size, sampleSize: sSize });
}

// ── Wallpaper ────────────────────────────────────────────
const DESKTOP_KEY = 'HKCU\\Control Panel\\Desktop';

async function getWallpaper() {
  const wp = await queryValue(DESKTOP_KEY, 'Wallpaper');
  const style = await queryValue(DESKTOP_KEY, 'WallpaperStyle');
  const tile = await queryValue(DESKTOP_KEY, 'TileWallpaper');
  return {
    ok: wp.ok,
    path: wp.ok ? wp.value : null,
    style: style.ok ? style.value : null,
    tile: tile.ok ? tile.value : null,
    error: wp.ok ? null : wp.error
  };
}

function helperPath() {
  return helper.helperPath();
}

async function systemParametersInfoWallpaper(filePath) {
  if (!path.isAbsolute(filePath)) {
    return { ok: false, error: 'wallpaper path must be absolute: ' + filePath };
  }
  return helper.setWallpaper(filePath);
}

/**
 * Broadcast WM_SETTINGCHANGE("ImmersiveColorSet") + WM_DWMCOLORIZATIONCOLORCHANGED
 * through the helper so apps repaint after a theme/accent write. Best-effort:
 * a missing helper only degrades the result to "takes effect on next logon".
 */
async function refreshThemeChange() {
  return helper.refreshTheme();
}

/**
 * Apply a desktop wallpaper.
 * 1. registry: Wallpaper=<path>, WallpaperStyle=10 (fill), TileWallpaper=0
 * 2. repaint: SystemParametersInfo(SPI_SETDESKWALLPAPER=20, 0, path, 3) via our
 *    C# helper (no PowerShell, no rundll32 — one binary, no dependencies).
 * The path is constrained to an absolute one that exists, because it is handed
 * to another process and to the registry.
 */
async function applyWallpaper(filePath) {
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'no wallpaper path' };
  if (!path.isAbsolute(filePath)) return { ok: false, error: 'wallpaper path must be absolute: ' + filePath };
  if (!fs.existsSync(filePath)) return { ok: false, error: 'wallpaper not found: ' + filePath };
  const steps = [];
  steps.push(await writeString(DESKTOP_KEY, 'Wallpaper', filePath));
  steps.push(await writeString(DESKTOP_KEY, 'WallpaperStyle', '10')); // 10 = Fill
  steps.push(await writeString(DESKTOP_KEY, 'TileWallpaper', '0'));
  const regOk = steps.every(s => s.ok);
  if (!regOk) return { ok: false, error: (steps.find(s => !s.ok) || {}).error || 'registry write failed', path: filePath };
  const spi = await systemParametersInfoWallpaper(filePath);
  return {
    ok: !!spi.ok,
    path: filePath,
    registryApplied: true,
    systemParametersInfo: !!spi.ok,
    helperOutput: spi.output || null,
    error: spi.ok ? null : spi.error
  };
}

// ── Aggregate state (read-only) ──────────────────────────
async function getState() {
  const host = hostKind();
  if (host === 'unsupported') {
    return { ok: false, supported: false, host, error: 'Shell controls require Windows (' + process.platform + ')' };
  }
  const [taskbar, theme, accent, wallpaper] = await Promise.all([
    getTaskbarState(), getTheme(), getAccent(), getWallpaper()
  ]);
  return {
    ok: true,
    supported: true,
    host,
    platform: process.platform,
    taskbar,
    theme,
    accent,
    wallpaper: Object.assign({}, wallpaper, { fromWallpaper: null }),
    helper: { path: helperPath(), exists: fs.existsSync(helperPath()) },
    widget: { repo: 'https://github.com/smouj/openclaw-desktop-widget' }
  };
}

/** Accent derived from the current (or given) wallpaper. Pure read. */
async function accentFromWallpaper(filePath) {
  let wp = filePath;
  if (!wp) {
    const cur = await getWallpaper();
    wp = cur.path;
  }
  const res = extractAccentFromWallpaper(wp);
  return Object.assign({ wallpaperPath: wp }, res);
}

module.exports = {
  // capability / plumbing
  supported, hostKind, regExe,
  // taskbar
  getTaskbarState, setPosition, setAutoHide, restartExplorer,
  applyPositionToBlob, applyAutoHideToBlob,
  getState, accentFromWallpaper,
  // theme
  getTheme, setDark,
  // accent
  getAccent, setAccent, averageAccentRgb, extractAccentFromWallpaper,
  rgbToHex, decodeAbgr, decodeArgb, encodeAbgr, encodeArgb,
  // wallpaper
  getWallpaper, applyWallpaper, systemParametersInfoWallpaper, refreshThemeChange, helperPath,
  // constants worth documenting
  constants: { STUCK_KEY, STUCK_VALUE, POSITION_BYTE, AUTOHIDE_BYTE, AUTOHIDE_BIT, POSITION_NAMES, PERSONALIZE_KEY, DWM_KEY, DESKTOP_KEY, MAX_SAMPLE_DIM },
  // used by the CLI below and by tests
  _internal: { queryValue, queryDword, writeDword, readBinary, writeBinary, parseQueryLine }
};

// ── CLI (read-only helpers + dry-run plan) ───────────────
if (require.main === module) {
  const cmd = process.argv[2] || 'state';
  const print = (o) => console.log(JSON.stringify(o, null, 2));
  (async () => {
    switch (cmd) {
      case 'state': print(await getState()); break;
      case 'taskbar': print(await getTaskbarState()); break;
      case 'theme': print(await getTheme()); break;
      case 'accent': print(await getAccent()); break;
      case 'wallpaper': print(await getWallpaper()); break;
      case 'accent-from-wallpaper': print(await accentFromWallpaper(process.argv[3])); break;
      case 'restart-explorer': print(await restartExplorer({ dryRun: true })); break;
      default:
        console.error('usage: node src/shell/taskbar.js [state|taskbar|theme|accent|wallpaper|accent-from-wallpaper <path>|restart-explorer]');
        process.exit(2);
    }
  })().catch((e) => { console.error(TAG, e && e.stack ? e.stack : e); process.exit(1); });
}
