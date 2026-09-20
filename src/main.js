'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — Electron main process
//
// Owns: the overlay window, the tray/menus, global shortcuts, config
// persistence, the metrics refresh loop and every IPC handler.
// Does NOT own: taskbar vibrancy. SysGlance configures the Windows shell and
// remembers what it wrote; the resident vibrancy effect belongs to OpenClaw
// Widget (see PRODUCT.md at the repo root and src/shell/panel.js).
//
// Modules:
//   src/config.js   defaults, validation, atomic persistence
//   src/log.js      console + rotating file log
//   src/metrics.js  fast (node:os) / slow (systeminformation) / static tiers
//   src/shell/*     Windows shell configuration (position, theme, accent, wallpaper)
// ═══════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const log = require('./log');
const configModule = require('./config');
const metrics = require('./metrics');
const profiles = require('./profiles');
const { HistoryStore } = require('./history');
const { AlertEngine } = require('./alerts');
const { evaluateHealth } = require('./health');
const shellIpc = require('./shell/ipc');
const { ShellJournal } = require('./shell/journal');

const SELF_TEST = process.argv.includes('--self-test');
// --screenshot[=dir] boots the real app, captures the panel (sidebar, settings,
// dock) and exits. Used to keep docs/*.png honest and to review visual changes.
const SCREENSHOT_ARG = process.argv.find((a) => a.startsWith('--screenshot'));
const SCREENSHOT = !!SCREENSHOT_ARG;
const SCREENSHOT_DIR = SCREENSHOT_ARG && SCREENSHOT_ARG.includes('=') ? SCREENSHOT_ARG.split('=')[1] : path.join(__dirname, '..', 'docs');
// --icons renders assets/logo.svg into every raster icon the app ships, so the
// mark cannot drift between the header, the tray, the installer and the README.
// Electron is the rasteriser — no image dependency is added.
const ICONS = process.argv.includes('--icons');
const APP_VERSION = app.getVersion();

// The suite footer, identical in the window, the tray menu and both repositories'
// READMEs (see the shared block at the end of README.md).
const SUITE_FOOTER = 'OpenClaw desktop suite · MIT · smouj';
const SUITE_FOOTER_LABEL = () => SUITE_FOOTER + ' · v' + APP_VERSION;

// ── single instance ─────────────────────────────────────
// Second launch focuses the running overlay instead of starting a twin.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // No logger yet (userData is not guaranteed before ready) — stderr is enough.
  process.stderr.write('[sysglance] another instance is already running; exiting.\n');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray = null;
let isVisible = true;
let positionLocked = true;
let isQuitting = false;
let shuttingDown = false;

// Live config (see src/config.js for the schema).
let config = configModule.defaults();
let configPath = null;
let profilesPath = null;
let profileUndo = null;

// Shell state cache for the tray menus (menus are built synchronously).
let shellApi = null;
let shellState = null;
let shellJournal = null;

// Metrics state: one fast snapshot, one slow snapshot, composed per broadcast.
let lastFast = null;
let lastSlow = null;
let fastMs = null;
let slowMs = null;
let staticData = null;
let fastTimer = null;
let slowTimer = null;
let fastRunning = false;
let slowRunning = false;
let fastSkippedTicks = 0;
let slowSkippedTicks = 0;
let fastFailedTicks = 0;
let slowFailedTicks = 0;
const historyStore = new HistoryStore({ intervalMs: 5000, retentionMs: 24 * 60 * 60 * 1000 });
const alertEngine = new AlertEngine();
let lastAnalysisAt = 0;

// Renderer-side errors seen in self-test mode.
const rendererErrors = [];

// ── config persistence ──────────────────────────────────
function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  profilesPath = path.join(app.getPath('userData'), 'profiles.json');
  shellJournal = new ShellJournal(path.join(app.getPath('userData'), 'shell-journal.json'));
  const res = configModule.load(configPath);
  config = res.config;
  for (const w of res.warnings) log.warn('config: ' + w);
  if (res.recovered) log.warn('config: ' + configPath + ' could not be parsed — defaults restored');
  else if (res.existed) log.info('config: loaded ' + configPath);
  else log.info('config: no file yet, defaults in use (' + configPath + ')');
}

function profileStorePath() {
  return profilesPath || path.join(app.getPath('userData'), 'profiles.json');
}

function applySavedProfile(name) {
  const found = profiles.get(profileStorePath(), name);
  if (!found.ok) return found;
  const next = configModule.normalize(found.profile.config).config;
  const beforeFast = config.refreshInterval;
  const beforeSlow = config.slowInterval;
  const beforeLayout = config.layout;
  const beforeAnchor = config.anchor;
  const beforeDisplay = config.displayId;
  const beforeTheme = config.theme;
  const beforeHotkeys = JSON.stringify(config.hotkeys);
  // Shell state is captured for portability, but applying it needs explicit
  // per-setting confirmation and Explorer restart. Keep it pending instead of
  // silently changing the registry from a profile click.
  const shellPending = JSON.stringify(config.shell) !== JSON.stringify(next.shell);
  profileUndo = configModule.normalize(config).config;
  for (const key of configModule.WRITABLE_KEYS) config[key] = next[key];
  saveConfig();
  sendConfig();
  if (config.layout !== beforeLayout || config.displayId !== beforeDisplay) { applyLayoutGeometry(config.layout); }
  if (config.layout !== beforeLayout) send('layout-changed', config.layout);
  if (config.anchor !== beforeAnchor) applyAnchorPosition(config.anchor);
  if (config.theme !== beforeTheme) send('theme-changed', config.theme);
  if (config.refreshInterval !== beforeFast || config.slowInterval !== beforeSlow) restartDataCollection();
  if (JSON.stringify(config.hotkeys) !== beforeHotkeys) registerShortcuts();
  rebuildTray();
  return { ok: true, name: found.profile.name, shellPending, applied: configModule.WRITABLE_KEYS.slice() };
}

function undoSavedProfile() {
  if (!profileUndo) return { ok: false, error: 'no profile change to undo' };
  const previous = profileUndo;
  profileUndo = null;
  const beforeFast = config.refreshInterval;
  const beforeSlow = config.slowInterval;
  const beforeLayout = config.layout;
  const beforeAnchor = config.anchor;
  const beforeDisplay = config.displayId;
  const beforeTheme = config.theme;
  const beforeHotkeys = JSON.stringify(config.hotkeys);
  for (const key of configModule.WRITABLE_KEYS) config[key] = previous[key];
  saveConfig();
  sendConfig();
  if (config.layout !== beforeLayout || config.displayId !== beforeDisplay) applyLayoutGeometry(config.layout);
  if (config.layout !== beforeLayout) send('layout-changed', config.layout);
  if (config.anchor !== beforeAnchor) applyAnchorPosition(config.anchor);
  if (config.theme !== beforeTheme) send('theme-changed', config.theme);
  if (config.refreshInterval !== beforeFast || config.slowInterval !== beforeSlow) restartDataCollection();
  if (JSON.stringify(config.hotkeys) !== beforeHotkeys) registerShortcuts();
  rebuildTray();
  return { ok: true, undone: true };
}

function saveConfig() {
  if (!configPath) return;
  try {
    config = configModule.save(configPath, config);
  } catch (err) {
    log.exception('saveConfig', err);
  }
}

/** Apply a validated single-key patch from any source (renderer, menu, IPC). */
function applyConfigPatch(key, value, origin) {
  const res = configModule.validatePatch(key, value);
  if (!res.ok) {
    log.warn('config: refused ' + key + '=' + JSON.stringify(value) + ' from ' + (origin || 'unknown') + ' (' + res.reason + ')');
    return false;
  }
  for (const w of res.warnings || []) log.warn('config: ' + w);
  config[key] = res.value;
  saveConfig();
  sendConfig();
  rebuildTray();
  return true;
}

// ── layout geometry ─────────────────────────────────────
function getTargetDisplay() {
  const displays = screen.getAllDisplays();
  const selected = config.displayId == null ? null : displays.find((display) => display.id === config.displayId);
  return selected || screen.getPrimaryDisplay();
}

function displayTopology() {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || ('Display ' + display.id),
    bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height },
    workArea: { x: display.workArea.x, y: display.workArea.y, width: display.workArea.width, height: display.workArea.height },
    scaleFactor: display.scaleFactor,
    refreshRate: Number.isFinite(display.refreshRate) ? display.refreshRate : null,
    rotation: display.rotation,
    size: { width: display.size.width, height: display.size.height },
    primary: display.id === screen.getPrimaryDisplay().id
  }));
}

function handleDisplayTopologyChange() {
  const displays = screen.getAllDisplays();
  if (config.displayId != null && !displays.some((display) => display.id === config.displayId)) {
    log.warn('selected display ' + config.displayId + ' is unavailable; falling back to primary');
    config.displayId = null;
    saveConfig();
    sendConfig();
  }
  applyLayoutGeometry(config.layout);
  send('display-topology-changed', displayTopology());
  broadcastSystemData();
}

function getLayoutBounds(layout) {
  const display = getTargetDisplay();
  const sw = display.workArea.width, sh = display.workArea.height;
  switch (layout) {
    case 'dock':   return { w: sw, h: 142, minW: 600, minH: 120, maxW: sw, maxH: 280 };
    case 'corner': return { w: 220, h: 260, minW: 180, minH: 200, maxW: 300, maxH: 400 };
    case 'sidebar':
    default:       return { w: 360, h: 720, minW: 280, minH: 400, maxW: 520, maxH: sh };
  }
}

function getPositionForAnchor(anchor, w, h) {
  const display = getTargetDisplay();
  const { x: sx, y: sy, width: sw, height: sh } = display.workArea;
  const m = 10;
  switch (anchor) {
    case 'top-left':     return { x: sx + m, y: sy + m };
    case 'bottom-left':  return { x: sx + m, y: sy + sh - h - m };
    case 'bottom-right': return { x: sx + sw - w - m, y: sy + sh - h - m };
    case 'top-right':
    default:             return { x: sx + sw - w - m, y: sy + m };
  }
}

// ── window ──────────────────────────────────────────────
function createWindow() {
  const bounds = getLayoutBounds(config.layout);
  const pos = getPositionForAnchor(config.anchor, bounds.w, bounds.h);

  mainWindow = new BrowserWindow({
    width: bounds.w,
    height: bounds.h,
    minWidth: bounds.minW,
    minHeight: bounds.minH,
    maxWidth: bounds.maxW,
    maxHeight: bounds.maxH,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    title: 'SysGlance ' + APP_VERSION,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // The renderer is untrusted UI code: it gets a narrow contextBridge API
      // and nothing else. See docs/IPC-SECURITY.md and src/preload.js.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Only throttles when the window is hidden, which for an overlay is
      // exactly when we want the renderer to sleep.
      backgroundThrottling: true
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'overlay', 0);
  if (positionLocked) mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.setBackgroundColor('#00000000');
  mainWindow.setOpacity(config.opacity);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => { if (!SELF_TEST) mainWindow.show(); });

  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    const where = (source || '').split(/[\\/]/).pop() + ':' + line;
    if (level >= 2) {
      rendererErrors.push(where + ' ' + message);
      log.error('renderer[' + where + '] ' + message);
    } else log.debug('renderer[' + where + '] ' + message);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    rendererErrors.push('did-fail-load ' + code + ' ' + desc);
    log.error('renderer failed to load (' + code + ' ' + desc + ') ' + url);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    rendererErrors.push('render-process-gone ' + details.reason);
    log.error('renderer process gone: ' + JSON.stringify(details));
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) => {
    rendererErrors.push('preload-error ' + err.message);
    log.error('preload error in ' + preloadPath + ': ' + err.message);
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); isVisible = false; }
  });

  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [x, y] = mainWindow.getPosition();
      config.lastX = x; config.lastY = y;
      saveConfig();
    }
  });

  mainWindow.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: '🔓 Drag Mode', type: 'checkbox', checked: !positionLocked, click: togglePositionLock },
      { type: 'separator' },
      { label: '📐 Compact', type: 'checkbox', checked: config.compactMode, click: toggleCompact },
      { label: '📁 Filesystem', type: 'checkbox', checked: config.showFilesystem, click: () => applyConfigPatch('showFilesystem', !config.showFilesystem, 'context-menu') },
      { type: 'separator' },
      { label: 'Layout', submenu: [
        { label: 'Sidebar (default)', type: 'radio', checked: config.layout === 'sidebar', click: () => setLayout('sidebar') },
        { label: 'Dock (bottom)', type: 'radio', checked: config.layout === 'dock', click: () => setLayout('dock') },
        { label: 'Corner (mini)', type: 'radio', checked: config.layout === 'corner', click: () => setLayout('corner') }
      ] },
      { label: 'Position', submenu: [
        { label: 'Top-Right', click: () => setAnchor('top-right') },
        { label: 'Top-Left', click: () => setAnchor('top-left') },
        { label: 'Bottom-Right', click: () => setAnchor('bottom-right') },
        { label: 'Bottom-Left', click: () => setAnchor('bottom-left') }
      ] },
      { label: 'Theme', submenu: [
        { label: '🌙 Dark', type: 'radio', checked: config.theme === 'dark', click: () => setTheme('dark') },
        { label: '☀️ Light', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') },
        { label: '📺 LCD', type: 'radio', checked: config.theme === 'lcd', click: () => setTheme('lcd') }
      ] },
      { label: '🪟 Shell', submenu: buildShellSubmenu() },
      { type: 'separator' },
      { label: '⚙️ Settings Panel', click: () => send('toggle-settings') },
      { type: 'separator' },
      { label: SUITE_FOOTER_LABEL(), enabled: false },
      { label: '❌ Quit', click: () => { isQuitting = true; app.quit(); } }
    ]).popup();
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, payload); } catch (err) { log.exception('send ' + channel, err); }
  }
}

function sendConfig() { send('config-changed', config); }

// ── tray ────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon = null;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = null;
    else {
      // Add the 2x representation so the glyph stays crisp on HiDPI taskbars.
      try {
        const hi = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray-icon@2x.png'));
        if (!hi.isEmpty()) trayIcon.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
      } catch (_) { /* 2x is optional */ }
    }
  } catch (_) { trayIcon = null; }
  if (!trayIcon) {
    log.warn('tray icon unreadable at ' + iconPath + ' — run `npm run icons`; using the built-in fallback');
    trayIcon = nativeImage.createFromBuffer(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10, 0x08, 0x06, 0x00, 0x00, 0x00, 0x31, 0xF7, 0x2E, 0x7A, 0x00, 0x00, 0x00, 0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xAE, 0xCE, 0x1C, 0xE9, 0x00, 0x00, 0x00, 0x04, 0x67, 0x41, 0x4D, 0x41, 0x00, 0x00, 0xB1, 0x8F, 0x0B, 0xFC, 0x61, 0x05, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00, 0x0E, 0xC3, 0x00, 0x00, 0x0E, 0xC3, 0x01, 0xC7, 0x6F, 0xA8, 0x64, 0x00, 0x00, 0x00, 0x18, 0x49, 0x44, 0x41, 0x54, 0x38, 0x4F, 0x63, 0x60, 0x18, 0x15, 0x30, 0x06, 0x64, 0x18, 0x14, 0x0C, 0x42, 0x03, 0xA6, 0x01, 0x14, 0x00, 0x01, 0x63, 0x08, 0x30, 0x7A, 0x5E, 0x49, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]));
  }
  tray = new Tray(trayIcon);
  tray.setToolTip('SysGlance ' + APP_VERSION);
  rebuildTray();
  tray.on('double-click', toggleVisibility);
}

function rebuildTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '👁 Show / Hide', accelerator: 'Ctrl+Shift+S', click: toggleVisibility },
    { type: 'separator' },
    { label: '🔓 Drag Mode', type: 'checkbox', checked: !positionLocked, click: togglePositionLock },
    { label: '📐 Compact', type: 'checkbox', checked: config.compactMode, click: toggleCompact },
    { label: '📁 Filesystem', type: 'checkbox', checked: config.showFilesystem, click: () => applyConfigPatch('showFilesystem', !config.showFilesystem, 'tray') },
    { type: 'separator' },
    { label: 'Layout', submenu: [
      { label: 'Sidebar', type: 'radio', checked: config.layout === 'sidebar', click: () => setLayout('sidebar') },
      { label: 'Dock', type: 'radio', checked: config.layout === 'dock', click: () => setLayout('dock') },
      { label: 'Corner', type: 'radio', checked: config.layout === 'corner', click: () => setLayout('corner') }
    ] },
    { label: 'Position', submenu: [
      { label: 'Top-Right', type: 'radio', checked: config.anchor === 'top-right', click: () => setAnchor('top-right') },
      { label: 'Top-Left', type: 'radio', checked: config.anchor === 'top-left', click: () => setAnchor('top-left') },
      { label: 'Bottom-Right', type: 'radio', checked: config.anchor === 'bottom-right', click: () => setAnchor('bottom-right') },
      { label: 'Bottom-Left', type: 'radio', checked: config.anchor === 'bottom-left', click: () => setAnchor('bottom-left') }
    ] },
    { label: 'Theme', submenu: [
      { label: '🌙 Dark', type: 'radio', checked: config.theme === 'dark', click: () => setTheme('dark') },
      { label: '☀️ Light', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') },
      { label: '📺 LCD', type: 'radio', checked: config.theme === 'lcd', click: () => setTheme('lcd') }
    ] },
    { label: '🪟 Shell', submenu: buildShellSubmenu() },
    { type: 'separator' },
    { label: '⚙️ Settings Panel', click: () => send('toggle-settings') },
    { label: '📊 Refresh now', click: () => { runFastCycle(); runSlowCycle(); } },
    { type: 'separator' },
    // Same wording as the README footer, kept in one place (SUITE_FOOTER_LABEL).
    { label: SUITE_FOOTER_LABEL(), enabled: false },
    { label: '❌ Quit SysGlance', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

// ── Shell (taskbar / theme / accent / wallpaper) ────────
// SysGlance configures the Windows shell and persists what it wrote. It never
// starts a resident effect: taskbar vibrancy is kept alive by OpenClaw Widget.
function registerShell() {
  try {
    shellApi = shellIpc.register({
      getWindow: () => mainWindow,
      getConfig: () => config,
      saveConfig,
      log: (m) => log.info('[shell] ' + m),
      openExternal: (url) => shell.openExternal(url),
      appVersion: APP_VERSION,
      journal: shellJournal
    });
  } catch (err) {
    log.exception('shell registration', err);
    shellApi = null;
  }
}

async function refreshShellState() {
  if (!shellApi) return;
  try { shellState = await shellApi.state(); } catch (err) { shellState = null; log.debug('shell state unavailable: ' + err.message); }
  rebuildTray();
}

async function runShellAction(label, fn) {
  if (!shellApi) { log.error('[shell] ' + label + ': shell IPC not available'); return; }
  try {
    const r = await fn();
    if (r && r.ok === false) log.error('[shell] ' + label + ' failed: ' + (r.error || 'unknown error'));
    else if (r && r.changed && r.restartRequired) log.warn('[shell] ' + label + ' ok — explorer.exe restart required to apply');
    else log.info('[shell] ' + label + ' ok');
  } catch (err) {
    log.exception('shell action ' + label, err);
  }
  refreshShellState();
}

function buildShellSubmenu() {
  const s = config.shell || {};
  const tb = (shellState && shellState.taskbar && shellState.taskbar.ok) ? shellState.taskbar : null;
  const now = tb ? ' (now: ' + tb.position + ')' : '';
  return [
    { label: 'Taskbar position' + now, submenu: [
      { label: 'Left', type: 'radio', checked: !!tb && tb.positionIndex === 0, click: () => runShellAction('taskbar position=left', () => shellApi.setPosition('left')) },
      { label: 'Top', type: 'radio', checked: !!tb && tb.positionIndex === 1, click: () => runShellAction('taskbar position=top', () => shellApi.setPosition('top')) },
      { label: 'Right', type: 'radio', checked: !!tb && tb.positionIndex === 2, click: () => runShellAction('taskbar position=right', () => shellApi.setPosition('right')) },
      { label: 'Bottom', type: 'radio', checked: !!tb && tb.positionIndex === 3, click: () => runShellAction('taskbar position=bottom', () => shellApi.setPosition('bottom')) }
    ] },
    { label: 'Auto-hide taskbar' + (tb ? ' (' + (tb.autoHide ? 'on' : 'off') + ')' : ''), type: 'checkbox', checked: tb ? tb.autoHide : !!s.autoHide, click: (item) => runShellAction('auto-hide=' + item.checked, () => shellApi.setAutoHide(item.checked)) },
    { type: 'separator' },
    { label: 'Dark mode', type: 'checkbox', checked: s.darkMode !== false, click: (item) => runShellAction('dark=' + item.checked, () => shellApi.setDark(item.checked)) },
    { label: 'Accent from wallpaper', click: () => runShellAction('accent from wallpaper', () => shellApi.accentAuto()) },
    { label: 'Re-apply saved wallpaper', enabled: !!s.wallpaperPath, click: () => runShellAction('wallpaper', () => shellApi.applyWallpaper(s.wallpaperPath)) },
    { type: 'separator' },
    { label: 'Taskbar vibrancy', submenu: [
      { label: 'Owned by OpenClaw Widget', enabled: false },
      { label: 'Open Widget repository', click: () => shell.openExternal(shellIpc.WIDGET_REPO) }
    ] },
    { type: 'separator' },
    { label: '⟳ Restart Explorer (apply taskbar changes)', click: () => runShellAction('restart explorer', () => shellApi.restartExplorer()) },
    { label: tb ? 'Shell: ' + tb.position + ', autohide ' + (tb.autoHide ? 'on' : 'off') : 'Shell: state unavailable', enabled: false }
  ];
}

// ── actions ─────────────────────────────────────────────
function toggleVisibility() {
  if (!mainWindow) return;
  isVisible = !isVisible;
  if (isVisible) mainWindow.show();
  else mainWindow.hide();
  send('visibility-changed', isVisible);
  rebuildTray();
}

function togglePositionLock() {
  positionLocked = !positionLocked;
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(positionLocked, { forward: true });
    mainWindow.setFocusable(!positionLocked);
    mainWindow.setAlwaysOnTop(true, positionLocked ? 'overlay' : 'floating', 0);
  }
  send('position-lock-changed', positionLocked);
  rebuildTray();
}

function toggleCompact() {
  applyConfigPatch('compactMode', !config.compactMode, 'toggle-compact');
  send('compact-mode-changed', config.compactMode);
}

function setTheme(t) {
  if (!applyConfigPatch('theme', t, 'set-theme')) return;
  send('theme-changed', config.theme);
}

function setAnchor(a) {
  if (!applyConfigPatch('anchor', a, 'set-anchor')) return;
  applyAnchorPosition(config.anchor);
}

// Geometry lives in two helpers so *any* path that changes layout/anchor — the
// dedicated IPC, the settings panel (which sends set-config), the tray menu —
// moves the window. Before this, choosing "Dock" in the settings panel changed
// the internal CSS layout but left the window at sidebar dimensions.
function applyLayoutGeometry(layout) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = getLayoutBounds(layout);
  mainWindow.setMinimumSize(bounds.minW, bounds.minH);
  mainWindow.setMaximumSize(bounds.maxW, bounds.maxH);
  mainWindow.setSize(bounds.w, bounds.h);
  const pos = getPositionForAnchor(config.anchor, bounds.w, bounds.h);
  mainWindow.setPosition(pos.x, pos.y);
}

function applyAnchorPosition(anchor) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getSize();
  const pos = getPositionForAnchor(anchor, w, h);
  mainWindow.setPosition(pos.x, pos.y);
}

function setLayout(layout) {
  if (!applyConfigPatch('layout', layout, 'set-layout')) return;
  applyLayoutGeometry(config.layout);
  send('layout-changed', config.layout);
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const hotkeys = config.hotkeys || {};
  const bindings = [
    ['toggle', toggleVisibility],
    ['lock', togglePositionLock],
    ['palette', () => send('toggle-palette')]
  ];
  for (const [name, action] of bindings) {
    const accelerator = hotkeys[name];
    if (!accelerator) continue;
    try {
      if (!globalShortcut.register(accelerator, action)) log.warn('hotkey unavailable: ' + name + ' (' + accelerator + ')');
    } catch (err) { log.warn('hotkey refused: ' + name + ' (' + err.message + ')'); }
  }
}

// ── metrics loop ────────────────────────────────────────
const msSince = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;

async function runFastCycle() {
  if (fastRunning) { fastSkippedTicks++; return; }
  fastRunning = true;
  const t0 = process.hrtime.bigint();
  try {
    lastFast = await metrics.collectFast();
    fastMs = msSince(t0);
    if (lastFast.cpu && lastFast.cpu.load === 0 && fastMs > 50) {
      log.debug('fast cycle unusually slow: ' + fastMs + ' ms');
    }
    broadcastSystemData();
  } catch (err) {
    fastFailedTicks++;
    log.exception('fast metrics cycle', err);
  } finally {
    fastRunning = false;
  }
}

async function runSlowCycle() {
  if (slowRunning) { slowSkippedTicks++; return; }
  slowRunning = true;
  const t0 = process.hrtime.bigint();
  try {
    lastSlow = await metrics.collectSlow({ sections: config.showSections });
    slowMs = msSince(t0);
    broadcastSystemData();
  } catch (err) {
    slowFailedTicks++;
    log.exception('slow metrics cycle', err);
  } finally {
    slowRunning = false;
  }
}

/** Compose the renderer payload from the two tiers + the static cache. */
function composePayload() {
  const st = staticData;
  const fast = lastFast;
  const slow = lastSlow;
  const memory = fast
    ? { ...fast.memory }
    : { total: 0, used: 0, free: 0, percentage: 0, swapTotal: 0, swapUsed: 0, source: 'pending' };
  if (slow && slow.memory) {
    memory.swapTotal = slow.memory.swapTotal;
    memory.swapUsed = slow.memory.swapUsed;
  }
  const sections = config.showSections || {};
  const payload = {
    timestamp: Date.now(),
    layout: config.layout,
    cpu: fast ? {
      model: st ? st.cpuModel : 'CPU',
      cores: fast.cpu.cores,
      speed: fast.cpu.speedMhz,
      load: fast.cpu.load,
      perCore: fast.cpu.perCore.slice(0, 32),
      temp: slow && slow.temperature ? slow.temperature.main : null
    } : null,
    memory,
    gpu: slow ? slow.gpu : null,
    disks: slow && sections.disks !== false ? slow.disks : [],
    diskIO: slow && sections.disks !== false ? slow.diskIO : null,
    network: slow ? slow.network : { iface: '—', rx_sec: 0, tx_sec: 0 },
    processes: slow ? slow.processes : [],
    os: fast ? {
      distro: st ? st.os.distro : '—',
      release: st ? st.os.release : '—',
      hostname: fast.os.hostname,
      arch: fast.os.arch,
      uptime: fast.os.uptime,
      loadavg: fast.os.loadavg
    } : null,
    filesystem: slow ? slow.filesystem : null,
    battery: slow ? slow.battery : null,
    metrics: {
      fastMs,
      slowMs,
      fastAgeMs: fast ? Date.now() - fast.at : null,
      slowAgeMs: slow ? Date.now() - slow.at : null,
      refreshInterval: config.refreshInterval,
      slowInterval: config.slowInterval,
      slowCalls: slow ? slow.calls : [],
      sources: metrics.info,
      backpressure: {
        fastSkippedTicks, slowSkippedTicks, fastFailedTicks, slowFailedTicks,
        fastRunning, slowRunning
      }
    },
    config,
    displays: displayTopology()
  };
  const gpu = Array.isArray(payload.gpu) ? payload.gpu : [];
  const gpuTemperature = gpu.reduce((max, item) => Math.max(max, Number(item && item.temp) || -Infinity), -Infinity);
  const processCpu = Array.isArray(payload.processes) ? payload.processes.map((item) => Number(item.cpu) || 0) : [];
  const minDiskFree = Array.isArray(payload.disks) && payload.disks.length
    ? Math.min(...payload.disks.map((item) => Number(item.available) || 0)) : null;
  const sample = {
    cpu: payload.cpu ? payload.cpu.load : null,
    memory: payload.memory ? payload.memory.percentage : null,
    gpu: gpu.length && Number.isFinite(gpu[0].utilization) ? gpu[0].utilization : null,
    vram: gpu.length && gpu[0].vram && gpu[0].vramUsed != null ? (gpu[0].vramUsed / gpu[0].vram) * 100 : null,
    temperature: payload.cpu ? payload.cpu.temp : null,
    gpuTemperature: Number.isFinite(gpuTemperature) ? gpuTemperature : null,
    networkRx: payload.network ? payload.network.rx_sec : null,
    networkTx: payload.network ? payload.network.tx_sec : null
  };
  if (payload.timestamp !== lastAnalysisAt) {
    historyStore.record(sample, payload.timestamp);
    const transitions = alertEngine.evaluate({
      cpu: sample.cpu, memory: sample.memory, gpuTemperature: sample.gpuTemperature,
      minDiskFree, maxProcessCpu: processCpu.length ? Math.max(...processCpu) : null
    }, payload.timestamp).transitions;
    for (const event of transitions) {
      const level = event.type === 'RECOVERED' ? 'info' : 'warn';
      log[level]('alert ' + event.type.toLowerCase() + ': ' + event.label + (event.notify ? '' : ' (cooldown)'));
    }
    lastAnalysisAt = payload.timestamp;
  }
  payload.health = evaluateHealth(payload);
  payload.alerts = alertEngine.snapshot();
  payload.history = historyStore.snapshot(60 * 60 * 1000, payload.timestamp);
  return payload;
}

function broadcastSystemData() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  send('system-data', composePayload());
}

function diagnosticsConfig() {
  const copy = JSON.parse(JSON.stringify(config));
  if (copy.shell) copy.shell.wallpaperPath = copy.shell.wallpaperPath ? '[redacted]' : null;
  return copy;
}

async function diagnosticsSnapshot() {
  const payload = composePayload();
  const identity = await metrics.getStatic();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: { name: 'SysGlance', version: APP_VERSION, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: { type: process.platform, arch: process.arch, release: os.release() },
    identity: { cpuModel: identity.cpuModel, cpuCores: identity.cpuCores, cpuSpeedMhz: identity.cpuSpeedMhz, os: identity.os },
    display: payload.displays,
    metrics: {
      cpu: payload.cpu ? { load: payload.cpu.load, cores: payload.cpu.cores, speed: payload.cpu.speed } : null,
      memory: payload.memory ? { total: payload.memory.total, used: payload.memory.used, percentage: payload.memory.percentage } : null,
      gpu: (payload.gpu || []).map((item) => ({ name: item.name, utilization: item.utilization, vram: item.vram, vramUsed: item.vramUsed, temp: item.temp })),
      disks: (payload.disks || []).map((item) => ({ fs: item.fs, mount: item.mount, size: item.size, used: item.used, available: item.available, use: item.use, type: item.type })),
      network: payload.network ? {
        iface: payload.network.iface, rx_sec: payload.network.rx_sec, tx_sec: payload.network.tx_sec,
        sessionDownloaded: payload.network.sessionDownloaded, sessionUploaded: payload.network.sessionUploaded,
        peakRx: payload.network.peakRx, peakTx: payload.network.peakTx
      } : null,
      diskIO: payload.diskIO,
      health: payload.health,
      alerts: payload.alerts,
      performance: { fastMs: payload.metrics.fastMs, slowMs: payload.metrics.slowMs, backpressure: payload.metrics.backpressure, sources: payload.metrics.sources }
    },
    hardware: await metrics.getInspector(),
    config: diagnosticsConfig(),
    rendererErrors: rendererErrors.slice(-20)
  };
}

function startDataCollection() {
  stopDataCollection();
  staticData = null;
  fastTimer = setInterval(runFastCycle, config.refreshInterval);
  slowTimer = setInterval(runSlowCycle, config.slowInterval);
  metrics.getStatic().then((s) => {
    staticData = s;
    log.info('static tier cached for this session: ' + s.cpuModel + ' (' + s.cpuCores + ' cores), ' + s.os.distro + ' ' + s.os.release);
    broadcastSystemData();
  }).catch((err) => log.exception('static metrics', err));
  runFastCycle();
  runSlowCycle();
}

function stopDataCollection() {
  if (fastTimer) { clearInterval(fastTimer); fastTimer = null; }
  if (slowTimer) { clearInterval(slowTimer); slowTimer = null; }
}

/** Re-arm the timers after a cadence change. */
function restartDataCollection() {
  stopDataCollection();
  fastTimer = setInterval(runFastCycle, config.refreshInterval);
  slowTimer = setInterval(runSlowCycle, config.slowInterval);
  log.info('cadence: fast ' + config.refreshInterval + ' ms, hardware ' + config.slowInterval + ' ms');
}

// ── IPC ─────────────────────────────────────────────────
// Every handler validates its arguments: the renderer is untrusted code.
ipcMain.handle('get-system-data', () => composePayload());
ipcMain.handle('get-app-info', () => ({
  name: 'SysGlance',
  version: APP_VERSION,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  shellHost: shellApi ? safeShellHost() : 'unavailable',
  widgetRepo: shellIpc.WIDGET_REPO,
  refreshInterval: config.refreshInterval,
  slowInterval: config.slowInterval,
  displays: displayTopology()
}));

// ── local desktop profiles ───────────────────────────────
ipcMain.handle('profiles:list', () => ({ ok: true, profiles: profiles.list(profileStorePath()) }));
ipcMain.handle('profiles:save', (_e, name) => profiles.upsert(profileStorePath(), name, config));
ipcMain.handle('profiles:apply', (_e, name) => applySavedProfile(name));
ipcMain.handle('profiles:undo', () => undoSavedProfile());
ipcMain.handle('profiles:delete', (_e, name) => profiles.remove(profileStorePath(), name));
ipcMain.handle('profiles:rename', (_e, oldName, newName) => profiles.rename(profileStorePath(), oldName, newName));
ipcMain.handle('profiles:duplicate', (_e, sourceName, targetName) => profiles.duplicate(profileStorePath(), sourceName, targetName));
ipcMain.handle('profiles:export', async (_e, name) => {
  const check = profiles.get(profileStorePath(), name);
  if (!check.ok) return check;
  try {
    const target = await dialog.showSaveDialog(mainWindow, {
      title: 'Export SysGlance profile',
      defaultPath: check.profile.name + '.sysglance-profile.json',
      filters: [{ name: 'SysGlance profile', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (target.canceled || !target.filePath) return { ok: false, canceled: true };
    return profiles.exportProfile(profileStorePath(), name, path.resolve(target.filePath));
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('profiles:import', async () => {
  try {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import SysGlance profile', properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'SysGlance profile', extensions: ['json'] }]
    });
    if (picked.canceled || !picked.filePaths || !picked.filePaths.length) return { ok: false, canceled: true };
    return profiles.importProfile(profileStorePath(), path.resolve(picked.filePaths[0]));
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('diagnostics:copy', async () => {
  try {
    clipboard.writeText(JSON.stringify(await diagnosticsSnapshot(), null, 2));
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('diagnostics:inspect', async (_event, force) => {
  try { return { ok: true, hardware: await metrics.getInspector(force === true), displays: displayTopology() }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('diagnostics:export', async () => {
  try {
    const target = await dialog.showSaveDialog(mainWindow, {
      title: 'Export SysGlance diagnostics', defaultPath: 'SysGlance-diagnostics.json',
      filters: [{ name: 'JSON diagnostics', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (target.canceled || !target.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(path.resolve(target.filePath), JSON.stringify(await diagnosticsSnapshot(), null, 2) + '\n', 'utf8');
    return { ok: true, filePath: path.resolve(target.filePath) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('copy-text', (_e, value) => {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    return { ok: false, error: 'invalid clipboard text' };
  }
  clipboard.writeText(value);
  return { ok: true };
});

// Fixed, user-facing control actions. The renderer can select an action name,
// never a URI, executable or argument list. No shell command is accepted here.
const CONTROL_ACTIONS = {
  settings: () => shell.openExternal('ms-settings:'),
  network: () => shell.openExternal('ms-settings:network'),
  display: () => shell.openExternal('ms-settings:display'),
  apps: () => shell.openExternal('ms-settings:appsfeatures'),
  taskManager: () => new Promise((resolve) => execFile('taskmgr.exe', [], { windowsHide: true }, (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }))),
  lock: () => new Promise((resolve) => execFile('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true }, (err) => resolve(err ? { ok: false, error: err.message } : { ok: true })))
};
ipcMain.handle('control:open', async (_event, action) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows control actions are unavailable on this host' };
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(CONTROL_ACTIONS, action)) return { ok: false, error: 'unknown control action' };
  try {
    const result = await CONTROL_ACTIONS[action]();
    if (typeof result === 'object') return result;
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// ── explicit process actions ─────────────────────────────
function validPid(pid) { return Number.isInteger(pid) && pid > 4 && pid <= 0x7fffffff; }

ipcMain.handle('process:openLocation', async (_e, pid) => {
  if (!validPid(pid)) return { ok: false, error: 'invalid process id' };
  const inspected = await metrics.inspectProcess(pid);
  if (!inspected.ok) return inspected;
  if (!inspected.path) return { ok: false, error: 'executable path unavailable' };
  let stat;
  try { stat = fs.statSync(inspected.path); } catch (_) { return { ok: false, error: 'executable no longer exists' }; }
  if (!stat.isFile()) return { ok: false, error: 'executable path is not a file' };
  const folder = path.dirname(inspected.path);
  const error = await shell.openPath(folder);
  return error ? { ok: false, error } : { ok: true, pid, name: inspected.name, path: inspected.path };
});

ipcMain.handle('process:endTask', async (_e, pid) => {
  if (process.platform !== 'win32') return { ok: false, error: 'end task is only supported on Windows' };
  if (!validPid(pid) || pid === process.pid) return { ok: false, error: 'invalid or protected process id' };
  const inspected = await metrics.inspectProcess(pid);
  if (!inspected.ok) return inspected;
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'End task?',
    message: 'End ' + inspected.name + ' (PID ' + pid + ')?',
    detail: 'The process and its child processes may lose unsaved work.',
    buttons: ['Cancel', 'End task'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirm.response !== 1) return { ok: false, canceled: true };
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: String(stderr || stdout || err.message).trim() });
      log.info('ended process ' + inspected.name + ' (PID ' + pid + ')');
      resolve({ ok: true, pid, name: inspected.name });
    });
  });
});

function safeShellHost() {
  try { return require('./shell/taskbar').hostKind(); } catch (_) { return 'unavailable'; }
}

ipcMain.handle('set-config', (_e, key, value) => {
  const beforeFast = config.refreshInterval, beforeSlow = config.slowInterval;
  const beforeLayout = config.layout, beforeAnchor = config.anchor;
  const beforeDisplay = config.displayId;
  const beforeHotkeys = JSON.stringify(config.hotkeys);
  const ok = applyConfigPatch(key, value, 'renderer');
  if (!ok) return { ok: false };
  // A settings change that implies a different window shape must actually
  // reshape the window, not only the DOM.
  if (config.layout !== beforeLayout) {
    applyLayoutGeometry(config.layout);
    send('layout-changed', config.layout);
  }
  if (config.displayId !== beforeDisplay) applyLayoutGeometry(config.layout);
  if (config.anchor !== beforeAnchor) applyAnchorPosition(config.anchor);
  if (config.refreshInterval !== beforeFast || config.slowInterval !== beforeSlow) restartDataCollection();
  if (JSON.stringify(config.hotkeys) !== beforeHotkeys) registerShortcuts();
  return { ok: true };
});

ipcMain.handle('set-opacity', (_e, v) => {
  const res = configModule.validatePatch('opacity', v);
  if (!res.ok) { log.warn('renderer sent an invalid opacity: ' + JSON.stringify(v)); return { ok: false }; }
  config.opacity = res.value;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(config.opacity);
  saveConfig();
  return { ok: true, opacity: config.opacity };
});

// ── home folders (the only directories the UI may open) ──
// The renderer asks to open a folder; the main process decides which folders
// exist to be asked about. Without this list, `open-folder` would be a generic
// "open any absolute path" primitive for a compromised renderer.
const HOME_FOLDER_NAMES = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'];

function allowedHomeFolders() {
  const home = os.homedir();
  const map = new Map();
  for (const name of HOME_FOLDER_NAMES) map.set(path.resolve(path.join(home, name)), name);
  return map;
}

ipcMain.handle('open-folder', async (_e, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath.trim() || !path.isAbsolute(folderPath)) {
    log.warn('refused open-folder: not an absolute path');
    return { ok: false, error: 'invalid path' };
  }
  const resolved = path.resolve(folderPath);
  const allowed = allowedHomeFolders();
  if (!allowed.has(resolved)) {
    log.warn('refused open-folder for a path outside the offered home folders: ' + resolved);
    return { ok: false, error: 'path not allowed' };
  }
  let stat;
  try { stat = fs.statSync(resolved); } catch (_) { return { ok: false, error: 'not found' }; }
  if (!stat.isDirectory()) return { ok: false, error: 'not a directory' };
  const err = await shell.openPath(resolved);
  if (err) { log.warn('open-folder failed: ' + err); return { ok: false, error: err }; }
  log.info('opened ' + allowed.get(resolved) + ' (' + resolved + ')');
  return { ok: true, name: allowed.get(resolved) };
});

ipcMain.on('toggle-position-lock', () => togglePositionLock());
ipcMain.on('toggle-visibility', () => toggleVisibility());
ipcMain.on('toggle-compact', () => toggleCompact());
ipcMain.on('quit-app', () => { isQuitting = true; app.quit(); });

// ── lifecycle ───────────────────────────────────────────
app.on('second-instance', () => {
  log.info('second instance launched — focusing the running overlay');
  if (mainWindow) {
    if (!isVisible) { isVisible = true; mainWindow.show(); }
    mainWindow.focus();
  }
});

process.on('uncaughtException', (err) => {
  log.exception('main process (uncaughtException)', err);
  if (!SELF_TEST) {
    try { dialog.showErrorBox('SysGlance error', String(err && err.message ? err.message : err)); } catch (_) { /* headless */ }
  }
});
process.on('unhandledRejection', (reason) => {
  log.exception('main process (unhandledRejection)', reason instanceof Error ? reason : new Error(String(reason)));
});

app.whenReady().then(() => {
  log.prime(path.join(app.getPath('userData'), 'logs'));
  log.info('SysGlance ' + APP_VERSION + ' starting — electron ' + process.versions.electron + ', node ' + process.versions.node + ', platform ' + process.platform);
  loadConfig();
  createWindow();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, handleDisplayTopologyChange);
  }
  registerShell();
  createTray();
  startDataCollection();
  refreshShellState();
  registerShortcuts();
  send('app-version', { version: APP_VERSION, electron: process.versions.electron });
  if (SELF_TEST) runSelfTest();
  if (SCREENSHOT) runScreenshot();
  if (ICONS) runIcons();
}).catch((err) => {
  log.exception('app.whenReady', err);
  app.exit(1);
});

app.on('window-all-closed', () => { /* tray app: stay alive */ });

app.on('before-quit', () => {
  isQuitting = true;
  if (shuttingDown) return;
  shuttingDown = true;
  stopDataCollection();
  saveConfig();
  globalShortcut.unregisterAll();
  log.info('SysGlance shutting down');
});

// ── self-test (CI / headless smoke test) ────────────────
// Boots the real window, reads one fast and one slow cycle, proves the preload
// bridge reached the renderer, then exits non-zero on any error.
function trayFooterLabelMatches() {
  return SUITE_FOOTER_LABEL() === SUITE_FOOTER + ' · v' + APP_VERSION;
}

// ── icon generation (dev) ───────────────────────────────
// assets/logo.svg is the single source of truth for the mark; everything raster
// is generated from it here. The plate matters: the mark is drawn white, so on a
// light background (light taskbar, GitHub's light theme, a white installer page)
// it disappears without one. The tray glyph deliberately has no plate and uses
// the accent colour, because a tray icon must read over both a dark and a light
// taskbar — and at 16 px the fine spokes of the mark are sub-pixel, which is why
// the small variants simply drop them.
function iconHtml(svg, size, opts) {
  const color = opts.color || '#ffffff';
  const pad = opts.plate ? Math.round(size * 0.17) : Math.max(0, Math.round(size * 0.02));
  const mark = size - pad * 2;
  const recoloured = svg
    .replace(/stroke="white"/g, 'stroke="' + color + '"')
    .replace(/fill="white"/g, 'fill="' + color + '"')
    .replace(/<svg\s/, '<svg width="' + mark + '" height="' + mark + '" ');
  const r = Math.round(size * 0.225);
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;width:' + size + 'px;height:' + size + 'px;background:transparent;overflow:hidden}' +
    '.plate{width:' + size + 'px;height:' + size + 'px;display:grid;place-items:center;border-radius:' + r + 'px;' +
    'background:linear-gradient(150deg,#1b2437 0%,#0c1120 55%,#0a0e18 100%);' +
    'box-shadow:inset 0 0 0 ' + Math.max(1, Math.round(size * 0.006)) + 'px rgba(255,255,255,0.12)}' +
    'svg{display:block}</style></head><body>' +
    (opts.plate ? '<div class="plate">' + recoloured + '</div>' : recoloured) +
    '</body></html>';
}

async function runIcons() {
  const fsx = require('fs');
  const outDir = path.join(__dirname, '..', 'assets');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ACCENT = '#3fe0ff';
  const targets = [
    { file: 'icon.png', size: 256, plate: true, color: '#ffffff' },
    { file: 'icon-512.png', size: 512, plate: true, color: '#ffffff' },
    { file: 'tray-icon.png', size: 16, plate: false, color: ACCENT },
    { file: 'tray-icon@2x.png', size: 32, plate: false, color: ACCENT }
  ];
  try {
    const svg = fsx.readFileSync(path.join(outDir, 'logo.svg'), 'utf8');
    console.log('[icons] source: assets/logo.svg');
    for (const t of targets) {
      const win = new BrowserWindow({
        width: t.size, height: t.size, show: true, frame: false, transparent: true,
        resizable: false, skipTaskbar: true, hasShadow: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(iconHtml(svg, t.size, t)));
      await sleep(220);
      const shot = await win.webContents.capturePage();
      const exact = shot.getSize().width === t.size ? shot : shot.resize({ width: t.size, height: t.size, quality: 'best' });
      fsx.writeFileSync(path.join(outDir, t.file), exact.toPNG());
      console.log('[icons] ' + t.file.padEnd(18) + t.size + 'x' + t.size + (t.plate ? ' plate' : ' transparent') + ' ok');
      win.destroy();
    }
    console.log('[icons] done');
  } catch (err) {
    console.error('[icons] failed: ' + (err && err.stack ? err.stack : err));
    isQuitting = true;
    app.exit(1);
    return;
  }
  isQuitting = true;
  app.exit(0);
}

// ── screenshot (dev/docs) ───────────────────────────────
// A transparent window over nothing has no backdrop to blur, so the glass looks
// flat. This paints a desktop-like gradient behind the page (html.shot) purely
// for the capture, then writes PNGs and quits.
async function runScreenshot() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fsx = require('fs');
  const ALL_OFF = { cpu: false, memory: false, gpu: false, filesystem: false, disks: false, network: false, processes: false, battery: false };
  const ALL_ON = { cpu: true, memory: true, gpu: true, filesystem: true, disks: true, network: true, processes: true, battery: true };
  const shots = [
    { file: 'screenshot.png', label: 'sidebar', layout: 'sidebar', settings: false },
    { file: 'screenshot-settings.png', label: 'settings', layout: 'sidebar', settings: true },
    { file: 'screenshot-dock.png', label: 'dock', layout: 'dock', settings: false },
    { file: 'screenshot-mini.png', label: 'mini', layout: 'corner', settings: false },
    // The Shell card lives below the fold in a 720 px window, so the shell shot
    // hides every metric section to bring it into view.
    { file: 'screenshot-shell.png', label: 'shell', layout: 'sidebar', settings: false, sections: ALL_OFF },
    // The smallest sidebar the app allows: the place where clipping shows up.
    { file: 'screenshot-small.png', label: 'minimum size', layout: 'sidebar', settings: false, sections: ALL_ON, size: { w: 280, h: 400 } }
  ];
  try {
    fsx.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await sleep(1200);   // let the first fast + slow cycles land
    await mainWindow.webContents.executeJavaScript(`
      document.documentElement.classList.add('shot');
      if (!document.querySelector('.shot-desktop')) {
        var d = document.createElement('div');
        d.className = 'shot-desktop';
        document.documentElement.insertBefore(d, document.body);
      }
      true;
    `, true);
    await sleep(350);

    for (const shot of shots) {
      await mainWindow.webContents.executeJavaScript(
        `window.sysglance.setConfig('layout', '${shot.layout}');` +
        `window.sysglance.setConfig('showSections', ${JSON.stringify(shot.sections || ALL_ON)});` +
        `document.getElementById('settings-panel').classList.toggle('hidden', ${shot.settings ? 'false' : 'true'});` +
        `true;`, true);
      await sleep(1000);
      // Geometry is owned by the main process, so a shot that wants a specific
      // size asks here rather than through the renderer API.
      if (shot.size) {
        mainWindow.setSize(shot.size.w, shot.size.h);
        await sleep(500);
      }
      const image = await mainWindow.webContents.capturePage();
      const out = path.join(SCREENSHOT_DIR, shot.file);
      fsx.writeFileSync(out, image.toPNG());
      const size = image.getSize();
      console.log('[screenshot] ' + shot.label + ' -> ' + out + ' (' + size.width + 'x' + size.height + ')');
    }
    console.log('[screenshot] done');
    // Leave the user's real section selection untouched.
    await mainWindow.webContents.executeJavaScript(`window.sysglance.setConfig('showSections', ${JSON.stringify(ALL_ON)}); true;`, true);
  } catch (err) {
    console.error('[screenshot] failed: ' + (err && err.stack ? err.stack : err));
    isQuitting = true;
    app.exit(1);
    return;
  }
  isQuitting = true;
  app.exit(0);
}

async function runSelfTest() {
  const fail = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await sleep(600);
    const pkgVersion = require('../package.json').version;
    console.log('[self-test] version: app=' + APP_VERSION + ' package.json=' + pkgVersion + (APP_VERSION === pkgVersion ? ' OK' : ' MISMATCH'));
    if (APP_VERSION !== pkgVersion) fail.push('version mismatch');

    const t0 = process.hrtime.bigint();
    const fast = await metrics.collectFast();
    const fastMsProbe = msSince(t0);
    console.log('[self-test] fast cycle: ' + fastMsProbe + ' ms, cpu ' + fast.cpu.load + '% (' + fast.cpu.perCore.length + ' cores), mem ' + fast.memory.percentage + '% of ' + (fast.memory.total / 1073741824).toFixed(1) + ' GiB, uptime ' + Math.round(fast.os.uptime) + 's');
    if (!(fast.cpu.load >= 0) || !(fast.memory.total > 0)) fail.push('fast tier returned no data');

    const t1 = process.hrtime.bigint();
    const slow = await metrics.collectSlow({ sections: config.showSections });
    console.log('[self-test] slow cycle: ' + msSince(t1) + ' ms, calls [' + slow.calls.join(', ') + '], gpu ' + (slow.gpu ? slow.gpu.length : 0) + ', disks ' + slow.disks.length + ', procs ' + slow.processes.length + ', folders ' + (slow.filesystem ? slow.filesystem.folders.length : 0));
    if (!slow.filesystem || !slow.filesystem.folders.length) fail.push('slow tier returned no filesystem data');

    const composed = composePayload();
    console.log('[self-test] product layer: health=' + (composed.health && composed.health.rows ? composed.health.rows.length : 0) +
      ' rows, history=' + (composed.history && composed.history.summary ? composed.history.summary.cpu.count : 0) +
      ' CPU points, alerts=' + (composed.alerts && composed.alerts.active ? composed.alerts.active.length : 0) + ' active');
    if (!composed.health || composed.health.rows.length < 5) fail.push('health status did not produce the expected rows');
    if (!composed.history || !composed.history.summary) fail.push('history store did not produce a snapshot');
    if (!composed.alerts || !composed.alerts.rules) fail.push('alert engine did not produce a state snapshot');
    if (!Array.isArray(composed.displays) || !composed.displays.length) fail.push('display topology did not produce a display');

    const probe = await mainWindow.webContents.executeJavaScript(
      'JSON.stringify({ api: !!window.sysglance, apiKeys: window.sysglance ? Object.keys(window.sysglance).length : 0, profilesApi: !!(window.sysglance && window.sysglance.profiles), processesApi: !!(window.sysglance && window.sysglance.processes), diagnosticsApi: !!(window.sysglance && window.sysglance.diagnostics), displayOptions: !!document.getElementById("display-options"), palette: !!document.getElementById("command-palette"), versionText: (document.getElementById("app-version") || {}).textContent || null, suiteFooter: ((document.getElementById("suite-footer") || {}).textContent || "").replace(/\\s+/g, " ").trim() || null, shellSection: !!document.getElementById("sec-shell"), cpu: (document.getElementById("cpu-load") || {}).textContent || null })',
      true
    );
    const state = JSON.parse(probe);
    console.log('[self-test] renderer: ' + probe);
    if (!state.api) fail.push('window.sysglance missing (preload/contextBridge not wired)');
    if (!state.profilesApi) fail.push('profiles API missing from preload bridge');
    if (!state.processesApi) fail.push('process actions API missing from preload bridge');
    if (!state.diagnosticsApi) fail.push('diagnostics API missing from preload bridge');
    if (!state.displayOptions) fail.push('display selector missing from settings');
    if (!state.palette) fail.push('command palette missing from renderer');
    if (!state.shellSection) fail.push('shell panel did not inject');
    if (!/^v?\d+\.\d+\.\d+/.test(String(state.versionText))) fail.push('version not rendered in the UI');
    if (!state.suiteFooter || !state.suiteFooter.includes(SUITE_FOOTER) || !state.suiteFooter.includes(APP_VERSION)) {
      fail.push('shared suite footer missing or wrong: ' + state.suiteFooter);
    }
    const inspectorProbe = await mainWindow.webContents.executeJavaScript(
      'window.sysglance.diagnostics.inspect().then(function (r) { return JSON.stringify({ ok: !!(r && r.ok), system: !!(r && r.hardware && r.hardware.system), storage: !!(r && r.hardware && r.hardware.storage) }); })', true);
    console.log('[self-test] inspector: ' + inspectorProbe);
    const inspectorState = JSON.parse(inspectorProbe);
    if (!inspectorState.ok || !inspectorState.system || !inspectorState.storage) fail.push('system inspector did not return hardware data');

    // Collapsing is a full round trip: renderer -> IPC -> config validation ->
    // disk. Toggled twice so the user's saved layout is left as it was found.
    await mainWindow.webContents.executeJavaScript('document.querySelector("#sec-memory .section-header").click(); true;', true);
    await sleep(350);
    const collapsed = await mainWindow.webContents.executeJavaScript(
      'JSON.stringify({ dom: document.getElementById("sec-memory").classList.contains("is-collapsed"), aria: document.querySelector("#sec-memory .section-header").getAttribute("aria-expanded") })', true);
    console.log('[self-test] collapse round trip -> ' + collapsed + ' config=' + JSON.stringify(config.collapsedSections));
    const collapsedState = JSON.parse(collapsed);
    if (!collapsedState.dom || collapsedState.aria !== 'false') fail.push('collapsing a card did not take effect');
    if (!(config.collapsedSections || []).includes('memory')) fail.push('collapsed state was not persisted through the config layer');
    await mainWindow.webContents.executeJavaScript('document.querySelector("#sec-memory .section-header").click(); true;', true);
    await sleep(250);

    await sleep(400);
    if (rendererErrors.length) fail.push('renderer errors: ' + rendererErrors.join(' | '));

    // ── security assertions ──
    // These are the two places where a compromised renderer could otherwise
    // reach beyond its lane, so they are tested rather than asserted in prose.
    const outsideDir = process.platform === 'win32' ? (process.env.WINDIR || 'C:\\Windows') : '/etc';
    const refusedFolder = await mainWindow.webContents.executeJavaScript(
      'window.sysglance.openFolder(' + JSON.stringify(outsideDir) + ').then(function (r) { return JSON.stringify(r); })', true);
    console.log('[self-test] open-folder(' + outsideDir + ') -> ' + refusedFolder);
    if (!/"ok":false/.test(refusedFolder)) fail.push('open-folder did not refuse a path outside the offered home folders');

    const refusedWallpaper = await mainWindow.webContents.executeJavaScript(
      'window.sysglance.shell.wallpaperPreview(' + JSON.stringify(outsideDir) + ').then(function (p) { return JSON.stringify(p.result || p); })', true);
    console.log('[self-test] wallpaperPreview(' + outsideDir + ') -> ' + refusedWallpaper);
    if (!/"ok":false/.test(refusedWallpaper)) fail.push('wallpaperPreview accepted a non-image path');

    console.log('[self-test] log file: ' + log.file());
    if (fail.length) {
      console.log('[self-test] FAIL — ' + fail.join('; '));
      isQuitting = true;
      app.exit(1);
      return;
    }
    console.log('[self-test] PASS');
    isQuitting = true;
    app.exit(0);
  } catch (err) {
    console.error('[self-test] crashed: ' + (err && err.stack ? err.stack : err));
    isQuitting = true;
    app.exit(1);
  }
}
