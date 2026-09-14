// Controls SysGlance's own taskbar vibrancy helper.
// Replaces third-party apps (TranslucentTB and friends) with zero new dependencies:
// the helper is ~6 KB, compiled from our C# by scripts/build-native.ps1.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HELPER = path.join(__dirname, 'trayblur', 'SysGlanceTrayBlur.exe');
let child = null;

const helperExists = () => fs.existsSync(HELPER);
const isRunning = () => !!child;

function flags(opts = {}) {
  const out = [];
  if (opts.acrylic) out.push('--acrylic');
  if (opts.tint) out.push(`--tint=${String(opts.tint).replace(/^#/, '')}`);
  return out;
}

function runOnce(args) {
  return new Promise((resolve) => {
    if (!helperExists()) {
      return resolve({ ok: false, error: 'helper not built — run scripts/build-native.ps1' });
    }
    const p = spawn(HELPER, args, { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', (code) => resolve({ ok: code === 0, code, output: out.trim() }));
    p.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

// Apply once (no resident process).
const apply = (opts) => runOnce(['--once', ...flags(opts)]);
const clear = () => runOnce(['--clear']);

// Resident: keeps the effect across explorer restarts. ~2 s in-process re-apply.
function start(opts = {}) {
  stop();
  child = spawn(HELPER, ['--watch', ...flags(opts)], { windowsHide: true, stdio: 'ignore' });
  child.on('exit', () => { child = null; });
  return child.pid;
}

function stop() {
  if (!child) return;
  try { child.kill(); } catch (_) { /* already gone */ }
  child = null;
}

module.exports = { apply, clear, start, stop, isRunning, helperExists, HELPER };
