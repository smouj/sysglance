'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — native helper controller
//
// Thin wrapper around the one native binary this project ships:
// src/native/shell/SysGlanceShellHelper.exe, compiled from our own C# with the
// in-box .NET Framework compiler (scripts/build-native.ps1). No npm dependency.
//
// The helper is NOT committed (binaries do not belong in git). Its two modes
// are one-shot and exit immediately:
//
//   --wallpaper=<path>   SystemParametersInfo(SPI_SETDESKWALLPAPER)
//   --refresh-theme      broadcast WM_SETTINGCHANGE("ImmersiveColorSet")
//
// There is deliberately no resident mode here: the taskbar vibrancy effect is
// owned by OpenClaw Widget (PRODUCT.md rules 1 and 2), so SysGlance has no
// long-lived process to start or stop.
// ═══════════════════════════════════════════════════════

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HELPER = path.join(__dirname, 'shell', 'SysGlanceShellHelper.exe');

function helperPath() {
  return process.env.SYSGLANCE_HELPER || HELPER;
}

const helperExists = () => {
  try { return fs.existsSync(helperPath()); } catch (_) { return false; }
};

/** Run one helper mode to completion. Always resolves; never throws. */
function run(args, timeoutMs) {
  return new Promise((resolve) => {
    const exe = helperPath();
    if (!helperExists()) {
      return resolve({ ok: false, error: 'helper not built — run scripts/build-native.ps1 (expected at ' + exe + ')' });
    }
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} }, timeoutMs || 15000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output: out.trim(), error: code === 0 ? null : (err.trim() || out.trim() || 'exit code ' + code) });
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
  });
}

const setWallpaper = (filePath) => run(['--wallpaper=' + filePath], 15000);
const refreshTheme = () => run(['--refresh-theme'], 10000);

module.exports = { setWallpaper, refreshTheme, helperExists, helperPath, HELPER };
