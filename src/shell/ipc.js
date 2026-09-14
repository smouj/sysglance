'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — Shell IPC surface
//
// One place that owns every shell:* channel, so main.js only has to
// register this module and keep its tray menu in sync. No dependencies:
// it delegates to src/shell/taskbar.js (registry + wallpaper) and to the
// existing src/native/trayBlurController.js (taskbar vibrancy helper).
//
// Every channel that mutates something answers with
//     { result: <what happened>, state: <fresh shell state> }
// so the renderer can show a message and re-render in one round trip.
// `shell:taskbar:getState` answers with the state object itself.
//
// Channels:
//   shell:taskbar:getState          read everything (taskbar/theme/accent/wallpaper/blur)
//   shell:taskbar:setPosition       'left'|'top'|'right'|'bottom' | 0..3
//   shell:taskbar:setAutoHide       boolean
//   shell:taskbar:restartExplorer   apply pending taskbar changes (kills + relaunches explorer)
//   shell:theme:setDark             boolean
//   shell:accent:fromWallpaper      optional path -> {r,g,b,hex} sampled from the wallpaper
//   shell:accent:auto               derive from wallpaper + write DWM/Personalize accent keys
//   shell:wallpaper:apply           path -> registry + SystemParametersInfo via the C# helper
//   shell:wallpaper:pick            native file dialog -> path (UX helper for the panel)
//   shell:blur:apply                {acrylic?, tint?} one-shot vibrancy
//   shell:blur:start                {acrylic?, tint?} resident watcher
//   shell:blur:stop                 kill the resident watcher
//   shell:blur:status               {running, pid, helperExists, helperPath}
// ═══════════════════════════════════════════════════════

const path = require('path');
const taskbar = require('./taskbar');
const trayBlur = require('../native/trayBlurController');

let ipcMain = null;
let dialog = null;
try {
  const electron = require('electron') || {};
  ipcMain = electron.ipcMain || null;
  dialog = electron.dialog || null;
} catch (_) { /* not running inside Electron */ }

// Persisted under config.shell in userData/config.json (see main.js loadConfig).
const DEFAULT_SHELL = {
  taskbarBlur: { enabled: false, resident: false, acrylic: false, tint: null },
  taskbarPosition: null,   // 0..3, last value we wrote (null = untouched)
  autoHide: null,          // last value we wrote
  darkMode: null,          // last value we wrote
  accentAuto: false,
  accent: null,            // {r,g,b,hex} last derived/applied
  wallpaperPath: null
};

const CHANNELS = [
  'shell:taskbar:getState',
  'shell:taskbar:setPosition',
  'shell:taskbar:setAutoHide',
  'shell:taskbar:restartExplorer',
  'shell:theme:setDark',
  'shell:accent:fromWallpaper',
  'shell:accent:auto',
  'shell:wallpaper:apply',
  'shell:wallpaper:pick',
  'shell:blur:apply',
  'shell:blur:start',
  'shell:blur:stop',
  'shell:blur:status'
];

/**
 * @param {object} ctx
 * @param {() => Electron.BrowserWindow|null} ctx.getWindow
 * @param {() => object} ctx.getConfig      live config object (mutated in place)
 * @param {() => void}   ctx.saveConfig     existing persistence helper from main.js
 * @param {(msg: string) => void} [ctx.log]
 * @returns {{ state, setPosition, setAutoHide, setDark, accentFromWallpaper,
 *             accentAuto, applyWallpaper, blur, restartExplorer, channels, DEFAULT_SHELL }}
 */
function register(ctx) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('src/shell/ipc.js must be loaded inside Electron (ipcMain unavailable)');
  }
  const log = ctx.log || ((m) => console.log('[shell]', m));
  const shellConfig = () => {
    const cfg = ctx.getConfig() || {};
    if (!cfg.shell) cfg.shell = {};
    return cfg.shell;
  };

  const persist = (patch) => {
    const shell = shellConfig();
    Object.assign(shell, patch);
    try { ctx.saveConfig(); } catch (e) { log('config save failed: ' + e.message); }
    broadcast('shell-config-changed', shell);
    return shell;
  };

  function broadcast(channel, payload) {
    const win = ctx.getWindow && ctx.getWindow();
    if (win && !win.isDestroyed()) {
      try { win.webContents.send(channel, payload); } catch (_) {}
    }
  }

  // ── blur (native helper, already proven) ───────────────
  function blurStatus() {
    return {
      running: trayBlur.isRunning(),
      helperExists: trayBlur.helperExists(),
      helperPath: trayBlur.HELPER
    };
  }

  const blur = {
    async apply(opts) {
      const o = opts || {};
      const res = await trayBlur.apply(o);
      persist({ taskbarBlur: Object.assign({}, shellConfig().taskbarBlur, { enabled: !!res.ok, resident: false, acrylic: !!o.acrylic, tint: o.tint || null }) });
      return res;
    },
    start(opts) {
      const o = opts || {};
      if (!trayBlur.helperExists()) {
        return { ok: false, error: 'helper not built — run scripts/build-native.ps1' };
      }
      const pid = trayBlur.start(o);
      persist({ taskbarBlur: Object.assign({}, shellConfig().taskbarBlur, { enabled: true, resident: true, acrylic: !!o.acrylic, tint: o.tint || null }) });
      return { ok: true, pid, output: 'resident watcher started (re-applies every 2s)' };
    },
    stop() {
      trayBlur.stop();
      persist({ taskbarBlur: Object.assign({}, shellConfig().taskbarBlur, { resident: false }) });
      return { ok: true, output: 'resident watcher stopped' };
    },
    status() {
      return Object.assign({ ok: true }, blurStatus());
    }
  };

  // ── aggregate state ────────────────────────────────────
  async function state() {
    const st = await taskbar.getState();
    return Object.assign(st, { blur: blurStatus(), config: shellConfig() });
  }

  const answer = async (result) => ({ result, state: await state() });

  // The ImmersiveColorSet broadcast can take tens of seconds on a busy desktop
  // (one SendMessageTimeout per top-level window), so it never blocks a reply.
  function kickThemeBroadcast(why) {
    taskbar.refreshThemeChange().then((r) => {
      log('theme broadcast (' + why + '): ' + (r.ok ? r.output || 'ok' : 'failed — ' + r.error));
    }).catch((e) => log('theme broadcast (' + why + ') threw: ' + e.message));
  }

  // ── taskbar geometry ───────────────────────────────────
  async function setPosition(pos) {
    const res = await taskbar.setPosition(pos);
    if (res.ok) persist({ taskbarPosition: typeof pos === 'number' ? pos : res.positionIndex });
    if (res.ok && res.changed) log('taskbar position -> ' + res.position + ' (explorer.exe restart required to apply)');
    return res;
  }

  async function setAutoHide(enabled) {
    const res = await taskbar.setAutoHide(enabled);
    if (res.ok) persist({ autoHide: !!enabled });
    if (res.ok && res.changed) log('taskbar auto-hide -> ' + (enabled ? 'on' : 'off') + ' (explorer.exe restart required to apply)');
    return res;
  }

  async function restartExplorer() {
    const res = await taskbar.restartExplorer();
    if (res.ok && !res.dryRun) persist({ restartRequired: false });
    return res;
  }

  // ── theme / accent / wallpaper ─────────────────────────
  async function setDark(enabled) {
    const res = await taskbar.setDark(enabled);
    if (res.ok) {
      persist({ darkMode: !!enabled });
      res.refresh = 'sent (async broadcast)';
      kickThemeBroadcast('setDark');
    }
    return res;
  }

  async function accentFromWallpaper(filePath) {
    const res = await taskbar.accentFromWallpaper(filePath);
    if (res.ok) persist({ accent: { r: res.r, g: res.g, b: res.b, hex: res.hex }, wallpaperPath: res.wallpaperPath || shellConfig().wallpaperPath });
    return res;
  }

  async function accentAuto() {
    const derived = await taskbar.accentFromWallpaper();
    if (!derived.ok) return derived;
    const color = { r: derived.r, g: derived.g, b: derived.b };
    const res = await taskbar.setAccent(color, { auto: true });
    if (!res.ok) return res;
    persist({ accentAuto: true, accent: { r: color.r, g: color.g, b: color.b, hex: derived.hex }, wallpaperPath: derived.wallpaperPath || shellConfig().wallpaperPath });
    kickThemeBroadcast('accentAuto');
    return Object.assign({}, res, { derived: { r: color.r, g: color.g, b: color.b, hex: derived.hex }, refresh: 'sent (async broadcast)' });
  }

  async function applyWallpaper(filePath) {
    const res = await taskbar.applyWallpaper(filePath);
    if (res.ok) persist({ wallpaperPath: filePath });
    return res;
  }

  async function pickWallpaper() {
    if (!dialog || typeof dialog.showOpenDialog !== 'function') return { ok: false, error: 'dialog unavailable' };
    const win = ctx.getWindow && ctx.getWindow();
    const opts = {
      title: 'SysGlance — choose a desktop wallpaper',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'tif', 'tiff'] }]
    };
    try {
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
      return { ok: true, path: r.filePaths[0], base: path.basename(r.filePaths[0]) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── channel registration ───────────────────────────────
  ipcMain.handle('shell:taskbar:getState', () => state());
  ipcMain.handle('shell:taskbar:setPosition', (_e, pos) => setPosition(pos).then(answer));
  ipcMain.handle('shell:taskbar:setAutoHide', (_e, on) => setAutoHide(on).then(answer));
  ipcMain.handle('shell:taskbar:restartExplorer', () => restartExplorer().then(answer));
  ipcMain.handle('shell:theme:setDark', (_e, on) => setDark(on).then(answer));
  ipcMain.handle('shell:accent:fromWallpaper', (_e, p) => accentFromWallpaper(p).then(answer));
  ipcMain.handle('shell:accent:auto', () => accentAuto().then(answer));
  ipcMain.handle('shell:wallpaper:apply', (_e, p) => applyWallpaper(p).then(answer));
  ipcMain.handle('shell:wallpaper:pick', () => pickWallpaper().then(answer));
  ipcMain.handle('shell:blur:apply', (_e, opts) => blur.apply(opts).then(answer));
  ipcMain.handle('shell:blur:start', (_e, opts) => Promise.resolve(blur.start(opts)).then(answer));
  ipcMain.handle('shell:blur:stop', () => Promise.resolve(blur.stop()).then(answer));
  ipcMain.handle('shell:blur:status', () => Promise.resolve(blur.status()).then(answer));

  log('registered ' + CHANNELS.length + ' channels (host: ' + taskbar.hostKind() + ')');

  return {
    state, setPosition, setAutoHide, setDark, accentFromWallpaper, accentAuto,
    applyWallpaper, pickWallpaper, blur, restartExplorer,
    broadcast, CHANNELS, DEFAULT_SHELL
  };
}

module.exports = { register, DEFAULT_SHELL, CHANNELS };
