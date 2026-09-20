'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — Shell IPC surface
//
// One place that owns every shell:* channel, so main.js only has to register
// this module and keep its tray menu in sync. No npm dependencies: it
// delegates to src/shell/taskbar.js (registry + wallpaper + accent).
//
// Every channel that mutates something answers with
//     { result: <what happened>, state: <fresh shell state> }
// so the renderer can show a message and re-render in one round trip.
// `shell:taskbar:getState` answers with the state object itself.
//
// SCOPE — what is deliberately NOT here (PRODUCT.md, rules 1 and 2):
//   There is no shell:blur:* channel and no resident taskbar watcher.
//   SysGlance configures the shell; OpenClaw Widget is the single owner of the
//   resident taskbar vibrancy effect. `shell:widget:info` / `shell:widget:open`
//   exist so the UI can say where that effect lives and link to it.
//
// Channels:
//   shell:taskbar:getState          read everything (taskbar/theme/accent/wallpaper)
//   shell:taskbar:setPosition       'left'|'top'|'right'|'bottom' | 0..3
//   shell:taskbar:setAutoHide       boolean
//   shell:taskbar:restartExplorer   apply pending taskbar changes (kills + relaunches explorer)
//   shell:theme:setDark             boolean
//   shell:accent:fromWallpaper      optional path -> {r,g,b,hex} sampled from the wallpaper
//   shell:accent:auto               derive from wallpaper + write DWM/Personalize accent keys
//   shell:wallpaper:apply           path -> registry + SystemParametersInfo via the C# helper
//   shell:wallpaper:pick            native file dialog -> path (UX helper for the panel)
//   shell:widget:info               { repo, name } — the sibling app that owns vibrancy
//   shell:widget:open               open the OpenClaw Widget repository in the browser
// ═══════════════════════════════════════════════════════

const path = require('path');
const taskbar = require('./taskbar');
const { runShellTransaction } = require('./transaction');

const WIDGET_REPO = 'https://github.com/smouj/openclaw-desktop-widget';
const WIDGET_NAME = 'OpenClaw Widget';

let ipcMain = null;
let dialog = null;
try {
  const electron = require('electron') || {};
  ipcMain = electron.ipcMain || null;
  dialog = electron.dialog || null;
} catch (_) { /* not running inside Electron (verify script) */ }

const CHANNELS = [
  'shell:taskbar:getState',
  'shell:undo',
  'shell:taskbar:setPosition',
  'shell:taskbar:setAutoHide',
  'shell:taskbar:restartExplorer',
  'shell:theme:setDark',
  'shell:accent:fromWallpaper',
  'shell:accent:auto',
  'shell:accent:setHex',
  'shell:wallpaper:apply',
  'shell:wallpaper:pick',
  'shell:wallpaper:preview',
  'shell:wallpaper:list',
  'shell:wallpaper:galleryPreview',
  'shell:wallpaper:openFolder',
  'shell:folder:readCustomization',
  'shell:folder:writeCustomization',
  'shell:folder:listSpecial',
  'shell:folder:restoreDefault',
  'shell:startMenu:getState',
  'shell:startMenu:setToggle',
  'shell:startMenu:openPersonalization',
  'shell:widget:info',
  'shell:widget:open'
];

/**
 * @param {object} ctx
 * @param {() => Electron.BrowserWindow|null} ctx.getWindow
 * @param {() => object} ctx.getConfig        live config object (mutated in place)
 * @param {() => void}   ctx.saveConfig       persistence helper from main.js
 * @param {(msg: string) => void} [ctx.log]
 * @param {(url: string) => Promise} [ctx.openExternal]
 * @returns {{ state, setPosition, setAutoHide, setDark, accentFromWallpaper,
 *             accentAuto, accentSetHex, applyWallpaper, pickWallpaper,
 *             listWallpapers, wallpaperGalleryPreview, openWallpaperFolder,
 *             readFolderCustomization, writeFolderCustomization, listSpecialFolders,
 *             restoreFolderDefault, getStartMenuState, setStartMenuToggle,
 *             openWindowsPersonalization, restartExplorer,
 *             widgetInfo, openWidget, broadcast, CHANNELS, WIDGET_REPO }}
 */
function register(ctx) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('src/shell/ipc.js must be loaded inside Electron (ipcMain unavailable)');
  }
  const log = ctx.log || ((m) => console.log('[shell]', m));
  const journal = ctx.journal || null;
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
      try { win.webContents.send(channel, payload); } catch (_) { /* window going away */ }
    }
  }

  // ── aggregate state ────────────────────────────────────
  async function state() {
    const st = await taskbar.getState();
    return Object.assign(st, {
      config: shellConfig(),
      widget: { name: WIDGET_NAME, repo: WIDGET_REPO, ownsVibrancy: true }
    });
  }

  const answer = async (result) => ({ result, state: await state() });

  async function runShellMutation(action, meta) {
    const before = journal ? await taskbar.getState() : null;
    const result = await action();
    if (journal && result && result.ok && result.changed !== false) {
      const after = await taskbar.getState();
      journal.record('shell', before, after, meta || null);
    }
    return result;
  }

  async function captureProfileFolders() {
    const listed = await taskbar.listSpecialFolders();
    const out = {};
    if (!listed || !listed.ok || !Array.isArray(listed.folders)) return out;
    for (const folder of listed.folders) {
      if (!folder || !folder.exists || !folder.id || !folder.path) continue;
      const snapshot = await taskbar.readFolderCustomization(folder.path);
      if (snapshot && snapshot.ok) out[folder.id] = {
        hasDesktopIni: snapshot.hasDesktopIni === true,
        contentBase64: snapshot.hasDesktopIni && typeof snapshot.contentBase64 === 'string' ? snapshot.contentBase64 : null
      };
    }
    return out;
  }

  async function restoreProfileFolders(snapshots) {
    if (!snapshots || typeof snapshots !== 'object') return { ok: true, restored: 0 };
    const listed = await taskbar.listSpecialFolders();
    const paths = new Map((listed && listed.folders || []).map((folder) => [folder.id, folder.path]));
    let restored = 0;
    for (const [id, snapshot] of Object.entries(snapshots)) {
      const folderPath = paths.get(id);
      if (!folderPath || !snapshot) continue;
      const result = await taskbar.restoreFolderCustomization(folderPath, snapshot);
      if (!result.ok) return result;
      restored++;
    }
    return { ok: true, restored };
  }

  async function undo() {
    if (!journal) return { ok: false, error: 'shell undo journal unavailable' };
    const entry = journal.latest();
    if (!entry) return { ok: false, error: 'no shell change to undo' };
    let result;
    if (entry.kind === 'shell' || entry.kind === 'profile-shell') {
      const beforeShell = entry.kind === 'profile-shell' && entry.before && entry.before.shell ? entry.before.shell : entry.before;
      result = await taskbar.restoreShellState(beforeShell);
      if (result && result.ok && entry.kind === 'profile-shell' && entry.before && entry.before.folders) {
        result = await restoreProfileFolders(entry.before.folders);
      }
    } else if (entry.kind === 'folder') {
      const before = entry.before || {};
      result = typeof taskbar.restoreFolderCustomization === 'function'
        ? await taskbar.restoreFolderCustomization(entry.meta && entry.meta.folderPath, before)
        : await taskbar.writeFolderCustomization(entry.meta && entry.meta.folderPath, before.ok ? (before.iconResource || before.iconFile || null) : null);
    } else if (entry.kind === 'start-menu') {
      const before = entry.before || {};
      const pairs = [['showRecentApps', before.showRecentApps], ['showSuggestions', before.showSuggestions], ['fullScreenStart', before.fullScreenStart]];
      const results = [];
      for (const [name, value] of pairs) if (typeof value === 'boolean') results.push(await taskbar.setStartMenuToggle(name, value));
      const failed = results.find((item) => !item.ok);
      result = failed ? { ok: false, error: failed.error || 'start menu restore failed' } : { ok: true, restored: results.length };
    } else {
      result = { ok: false, error: 'unknown journal entry' };
    }
    if (result && result.ok) {
      journal.remove(entry.id);
      kickThemeBroadcast('undo');
      result.undone = entry.kind;
    }
    return result;
  }

  async function applyProfileShell(target, folderCustomizations) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return { ok: false, error: 'invalid shell profile' };
    const before = await taskbar.getState();
    if (!before.ok) return before;
    const folderTargets = folderCustomizations && typeof folderCustomizations === 'object' && !Array.isArray(folderCustomizations)
      ? folderCustomizations : {};
    const targetFolderIds = Object.keys(folderTargets);
    const beforeFolders = targetFolderIds.length ? await captureProfileFolders() : null;
    const listed = targetFolderIds.length ? await taskbar.listSpecialFolders() : { folders: [] };
    const folderPaths = new Map((listed && listed.folders || []).map((folder) => [folder.id, folder.path]));
    const operations = [];
    if (Number.isInteger(target.taskbarPosition)) operations.push({ label: 'taskbar position', run: () => taskbar.setPosition(target.taskbarPosition) });
    if (typeof target.autoHide === 'boolean') operations.push({ label: 'taskbar auto-hide', run: () => taskbar.setAutoHide(target.autoHide) });
    if (typeof target.darkMode === 'boolean') operations.push({ label: 'dark mode', run: () => taskbar.setDark(target.darkMode) });
    if (typeof target.wallpaperPath === 'string' && target.wallpaperPath) operations.push({ label: 'wallpaper', run: () => taskbar.applyWallpaper(target.wallpaperPath) });
    if (target.accentAuto === true) {
      operations.push({
        label: 'accent from wallpaper',
        run: async () => {
          const derived = await taskbar.accentFromWallpaper(target.wallpaperPath || undefined);
          if (!derived.ok) return derived;
          return taskbar.setAccent({ r: derived.r, g: derived.g, b: derived.b }, { auto: true });
        }
      });
    } else if (target.accent && typeof target.accent === 'object') {
      const { r, g, b } = target.accent;
      if ([r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        operations.push({ label: 'accent colour', run: () => taskbar.setAccent({ r, g, b }, { auto: false }) });
      }
    }
    for (const id of targetFolderIds) {
      const folderPath = folderPaths.get(id);
      const snapshot = folderTargets[id];
      if (!folderPath || !snapshot || typeof snapshot !== 'object') continue;
      operations.push({ label: 'folder icon ' + id, run: () => taskbar.restoreFolderCustomization(folderPath, snapshot) });
    }
    if (!operations.length) return { ok: true, changed: false, applied: [] };
    const transactionBefore = targetFolderIds.length ? { shell: before, folders: beforeFolders } : before;
    const transaction = await runShellTransaction(transactionBefore, operations, async (snapshot) => {
      const shellBefore = snapshot && snapshot.shell ? snapshot.shell : snapshot;
      const shellResult = await taskbar.restoreShellState(shellBefore);
      if (!shellResult.ok) return shellResult;
      return snapshot && snapshot.folders ? restoreProfileFolders(snapshot.folders) : shellResult;
    });
    if (!transaction.ok) return transaction;
    const after = await taskbar.getState();
    const afterState = targetFolderIds.length ? { shell: after, folders: await captureProfileFolders() } : after;
    const entry = journal ? journal.record('profile-shell', transactionBefore, afterState, { action: 'profile shell apply' }) : null;
    const restartRequired = transaction.results.some((item) => item.result && item.result.restartRequired);
    return { ok: true, changed: true, applied: operations.map((item) => item.label), restartRequired, journalId: entry && entry.id };
  }

  // The ImmersiveColorSet broadcast can take tens of seconds on a busy desktop
  // (one SendMessageTimeout per top-level window), so it never blocks a reply.
  function kickThemeBroadcast(why) {
    taskbar.refreshThemeChange().then((r) => {
      log('theme broadcast (' + why + '): ' + (r.ok ? r.output || 'ok' : 'failed — ' + r.error));
    }).catch((e) => log('theme broadcast (' + why + ') threw: ' + e.message));
  }

  // ── taskbar geometry ───────────────────────────────────
  async function setPosition(pos) {
    const res = await runShellMutation(() => taskbar.setPosition(pos), { action: 'taskbar position' });
    if (res.ok) persist({ taskbarPosition: typeof pos === 'number' ? pos : res.positionIndex });
    if (res.ok && res.changed) log('taskbar position -> ' + res.position + ' (explorer.exe restart required to apply)');
    return res;
  }

  async function setAutoHide(enabled) {
    const res = await runShellMutation(() => taskbar.setAutoHide(enabled), { action: 'taskbar auto-hide' });
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
    const res = await runShellMutation(() => taskbar.setDark(enabled), { action: 'dark mode' });
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
    const res = await runShellMutation(() => taskbar.setAccent(color, { auto: true }), { action: 'accent auto' });
    if (!res.ok) return res;
    persist({
      accentAuto: true,
      accent: { r: color.r, g: color.g, b: color.b, hex: derived.hex },
      wallpaperPath: derived.wallpaperPath || shellConfig().wallpaperPath
    });
    kickThemeBroadcast('accentAuto');
    return Object.assign({}, res, {
      derived: { r: color.r, g: color.g, b: color.b, hex: derived.hex },
      refresh: 'sent (async broadcast)'
    });
  }

  async function applyWallpaper(filePath) {
    const res = await runShellMutation(() => taskbar.applyWallpaper(filePath), { action: 'wallpaper' });
    if (res.ok) persist({ wallpaperPath: filePath });
    return res;
  }

  /**
   * Read-only thumbnail of the current (or given) wallpaper for the panel.
   * The path is validated in taskbar.js before anything decodes it, and the
   * result is a downscaled data URL — never the file itself.
   */
  async function wallpaperPreview(filePath) {
    let target = filePath;
    if (!target) {
      const current = shellConfig().wallpaperPath || (await taskbar.getWallpaper()).path;
      target = current;
    }
    if (!target) return { ok: false, error: 'no wallpaper set' };
    return taskbar.wallpaperPreview(target, 168);
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

  // ── accent hex picker ──────────────────────────────────
  async function accentSetHex(hex) {
    const res = await runShellMutation(() => taskbar.setAccentHex(hex), { action: 'accent color' });
    if (res.ok) {
      persist({ accentAuto: false, accent: { r: res.r, g: res.g, b: res.b, hex: res.hex } });
      kickThemeBroadcast('accentSetHex');
    }
    return res;
  }

  // ── wallpaper gallery ─────────────────────────────────
  async function listWallpapers(dirPath) {
    return taskbar.listWallpapers(dirPath || null);
  }

  async function wallpaperGalleryPreview(filePath) {
    return taskbar.wallpaperGalleryPreview(filePath);
  }

  async function openWallpaperFolder(dirPath) {
    const homeDir = require('os').homedir();
    const target = dirPath || require('path').join(homeDir, 'Pictures', 'Wallpaper');
    return taskbar.openInExplorer(target);
  }

  // ── folder customization ───────────────────────────────
  async function readFolderCustomization(folderPath) {
    return taskbar.readFolderCustomization(folderPath);
  }

  async function writeFolderCustomization(folderPath, iconSpec) {
    const before = journal ? await taskbar.readFolderCustomization(folderPath) : null;
    const res = await taskbar.writeFolderCustomization(folderPath, iconSpec);
    if (res.ok) {
      if (journal) journal.record('folder', before, await taskbar.readFolderCustomization(folderPath), { action: 'folder icon', folderPath });
      kickThemeBroadcast('folderCustomization');
    }
    return res;
  }

  async function listSpecialFolders() {
    return taskbar.listSpecialFolders();
  }

  async function restoreFolderDefault(folderPath) {
    const before = journal ? await taskbar.readFolderCustomization(folderPath) : null;
    const res = await taskbar.writeFolderCustomization(folderPath, null);
    if (res.ok && journal) journal.record('folder', before, await taskbar.readFolderCustomization(folderPath), { action: 'folder icon reset', folderPath });
    return res;
  }

  // ── start menu ─────────────────────────────────────────
  async function getStartMenuState() {
    return taskbar.getStartMenuState();
  }

  async function setStartMenuToggle(name, enabled) {
    const before = journal ? await taskbar.getStartMenuState() : null;
    const res = await taskbar.setStartMenuToggle(name, enabled);
    if (res.ok && journal) journal.record('start-menu', before, await taskbar.getStartMenuState(), { action: 'start menu', name });
    return res;
  }

  async function openWindowsPersonalization() {
    return taskbar.openWindowsPersonalization();
  }

  // ── sibling app (vibrancy owner) ───────────────────────
  function widgetInfo() {
    return {
      ok: true,
      name: WIDGET_NAME,
      repo: WIDGET_REPO,
      ownsVibrancy: true,
      note: 'SysGlance configures the taskbar. The resident vibrancy effect is kept alive by ' + WIDGET_NAME + '.'
    };
  }

  async function openWidget() {
    if (typeof ctx.openExternal !== 'function') return { ok: false, error: 'cannot open external links on this host' };
    try {
      await ctx.openExternal(WIDGET_REPO);
      return { ok: true, url: WIDGET_REPO };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── channel registration ───────────────────────────────
  ipcMain.handle('shell:taskbar:getState', () => state());
  ipcMain.handle('shell:undo', () => undo().then(answer));
  ipcMain.handle('shell:taskbar:setPosition', (_e, pos) => setPosition(pos).then(answer));
  ipcMain.handle('shell:taskbar:setAutoHide', (_e, on) => setAutoHide(on).then(answer));
  ipcMain.handle('shell:taskbar:restartExplorer', () => restartExplorer().then(answer));
  ipcMain.handle('shell:theme:setDark', (_e, on) => setDark(on).then(answer));
  ipcMain.handle('shell:accent:fromWallpaper', (_e, p) => accentFromWallpaper(p).then(answer));
  ipcMain.handle('shell:accent:auto', () => accentAuto().then(answer));
  ipcMain.handle('shell:wallpaper:apply', (_e, p) => applyWallpaper(p).then(answer));
  ipcMain.handle('shell:wallpaper:pick', () => pickWallpaper().then(answer));
  ipcMain.handle('shell:wallpaper:preview', (_e, p) => Promise.resolve(wallpaperPreview(p)).then((r) => ({ result: r })));
  ipcMain.handle('shell:wallpaper:list', (_e, d) => listWallpapers(d));
  ipcMain.handle('shell:wallpaper:galleryPreview', (_e, p) => Promise.resolve(wallpaperGalleryPreview(p)));
  ipcMain.handle('shell:wallpaper:openFolder', (_e, d) => openWallpaperFolder(d));
  ipcMain.handle('shell:accent:setHex', (_e, h) => accentSetHex(h).then(answer));
  ipcMain.handle('shell:folder:readCustomization', (_e, p) => readFolderCustomization(p));
  ipcMain.handle('shell:folder:writeCustomization', (_e, p, s) => writeFolderCustomization(p, s).then(answer));
  ipcMain.handle('shell:folder:listSpecial', () => listSpecialFolders());
  ipcMain.handle('shell:folder:restoreDefault', (_e, p) => restoreFolderDefault(p).then(answer));
  ipcMain.handle('shell:startMenu:getState', () => getStartMenuState());
  ipcMain.handle('shell:startMenu:setToggle', (_e, n, v) => setStartMenuToggle(n, v).then(answer));
  ipcMain.handle('shell:startMenu:openPersonalization', () => openWindowsPersonalization());

  ipcMain.handle('shell:widget:info', () => Promise.resolve(widgetInfo()));
  ipcMain.handle('shell:widget:open', () => openWidget());

  log('registered ' + CHANNELS.length + ' channels (host: ' + taskbar.hostKind() + ')');

  return {
    state, undo, setPosition, setAutoHide, setDark, accentFromWallpaper, accentAuto,
    applyWallpaper, pickWallpaper, wallpaperPreview, restartExplorer, widgetInfo, openWidget,
    applyProfileShell,
    listWallpapers, wallpaperGalleryPreview, openWallpaperFolder,
    readFolderCustomization, writeFolderCustomization, listSpecialFolders, restoreFolderDefault,
    getStartMenuState, setStartMenuToggle, openWindowsPersonalization,
    accentSetHex,
    broadcast, CHANNELS, WIDGET_REPO
  };
}

module.exports = { register, CHANNELS, WIDGET_REPO, WIDGET_NAME };
