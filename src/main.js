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

const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const log = require('./log');
const configModule = require('./config');
const metrics = require('./metrics');
const shellIpc = require('./shell/ipc');

const SELF_TEST = process.argv.includes('--self-test');
// --screenshot[=dir] boots the real app, captures the panel (sidebar, settings,
// dock) and exits. Used to keep docs/*.png honest and to review visual changes.
const SCREENSHOT_ARG = process.argv.find((a) => a.startsWith('--screenshot'));
const SCREENSHOT = !!SCREENSHOT_ARG;
const SCREENSHOT_DIR = SCREENSHOT_ARG && SCREENSHOT_ARG.includes('=') ? SCREENSHOT_ARG.split('=')[1] : path.join(__dirname, '..', 'docs');
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

// Shell state cache for the tray menus (menus are built synchronously).
let shellApi = null;
let shellState = null;

// Metrics state: one fast snapshot, one slow snapshot, composed per broadcast.
let lastFast = null;
let lastSlow = null;
let fastMs = null;
let slowMs = null;
let staticData = null;
let fastTimer = null;
let slowTimer = null;
let slowRunning = false;

// Renderer-side errors seen in self-test mode.
const rendererErrors = [];

// ── config persistence ──────────────────────────────────
function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  const res = configModule.load(configPath);
  config = res.config;
  for (const w of res.warnings) log.warn('config: ' + w);
  if (res.recovered) log.warn('config: ' + configPath + ' could not be parsed — defaults restored');
  else if (res.existed) log.info('config: loaded ' + configPath);
  else log.info('config: no file yet, defaults in use (' + configPath + ')');
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
function getLayoutBounds(layout) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  switch (layout) {
    case 'dock':   return { w: sw, h: 142, minW: 600, minH: 120, maxW: sw, maxH: 280 };
    case 'corner': return { w: 220, h: 260, minW: 180, minH: 200, maxW: 300, maxH: 400 };
    case 'sidebar':
    default:       return { w: 360, h: 720, minW: 280, minH: 400, maxW: 520, maxH: sh };
  }
}

function getPositionForAnchor(anchor, w, h) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m = 10;
  switch (anchor) {
    case 'top-left':     return { x: m, y: m };
    case 'bottom-left':  return { x: m, y: sh - h - m };
    case 'bottom-right': return { x: sw - w - m, y: sh - h - m };
    case 'top-right':
    default:             return { x: sw - w - m, y: m };
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
      backgroundThrottling: false
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
        { label: '☀️ Light', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') }
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
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('empty image');
  } catch (_) {
    // 16×16 opaque fallback so a missing asset never leaves the app trayless.
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
      { label: '☀️ Light', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') }
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
      appVersion: APP_VERSION
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

// ── metrics loop ────────────────────────────────────────
const msSince = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;

async function runFastCycle() {
  const t0 = process.hrtime.bigint();
  try {
    lastFast = await metrics.collectFast();
    fastMs = msSince(t0);
    if (lastFast.cpu && lastFast.cpu.load === 0 && fastMs > 50) {
      log.debug('fast cycle unusually slow: ' + fastMs + ' ms');
    }
    broadcastSystemData();
  } catch (err) {
    log.exception('fast metrics cycle', err);
  }
}

async function runSlowCycle() {
  if (slowRunning) return;
  slowRunning = true;
  const t0 = process.hrtime.bigint();
  try {
    lastSlow = await metrics.collectSlow({ sections: config.showSections });
    slowMs = msSince(t0);
    broadcastSystemData();
  } catch (err) {
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
  return {
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
      sources: metrics.info
    },
    config
  };
}

function broadcastSystemData() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  send('system-data', composePayload());
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
  slowInterval: config.slowInterval
}));

function safeShellHost() {
  try { return require('./shell/taskbar').hostKind(); } catch (_) { return 'unavailable'; }
}

ipcMain.handle('set-config', (_e, key, value) => {
  const beforeFast = config.refreshInterval, beforeSlow = config.slowInterval;
  const beforeLayout = config.layout, beforeAnchor = config.anchor;
  const ok = applyConfigPatch(key, value, 'renderer');
  if (!ok) return { ok: false };
  // A settings change that implies a different window shape must actually
  // reshape the window, not only the DOM.
  if (config.layout !== beforeLayout) {
    applyLayoutGeometry(config.layout);
    send('layout-changed', config.layout);
  }
  if (config.anchor !== beforeAnchor) applyAnchorPosition(config.anchor);
  if (config.refreshInterval !== beforeFast || config.slowInterval !== beforeSlow) restartDataCollection();
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

ipcMain.handle('open-folder', async (_e, folderPath) => {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) {
    log.warn('refused open-folder with a non-absolute path');
    return { ok: false, error: 'invalid path' };
  }
  let stat;
  try { stat = fs.statSync(folderPath); } catch (_) { return { ok: false, error: 'not found' }; }
  if (!stat.isDirectory()) return { ok: false, error: 'not a directory' };
  const err = await shell.openPath(folderPath);
  if (err) { log.warn('open-folder failed: ' + err); return { ok: false, error: err }; }
  return { ok: true };
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
  registerShell();
  createTray();
  startDataCollection();
  refreshShellState();
  globalShortcut.register('CommandOrControl+Shift+S', toggleVisibility);
  globalShortcut.register('CommandOrControl+Shift+L', togglePositionLock);
  send('app-version', { version: APP_VERSION, electron: process.versions.electron });
  if (SELF_TEST) runSelfTest();
  if (SCREENSHOT) runScreenshot();
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

// ── screenshot (dev/docs) ───────────────────────────────
// A transparent window over nothing has no backdrop to blur, so the glass looks
// flat. This paints a desktop-like gradient behind the page (html.shot) purely
// for the capture, then writes PNGs and quits.
async function runScreenshot() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fsx = require('fs');
  const shots = [
    { file: 'screenshot.png', label: 'sidebar', layout: 'sidebar', settings: false },
    { file: 'screenshot-settings.png', label: 'settings', layout: 'sidebar', settings: true },
    { file: 'screenshot-dock.png', label: 'dock', layout: 'dock', settings: false },
    { file: 'screenshot-mini.png', label: 'mini', layout: 'corner', settings: false }
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
        `document.getElementById('settings-panel').classList.toggle('hidden', ${shot.settings ? 'false' : 'true'});` +
        `true;`, true);
      await sleep(900);
      const image = await mainWindow.webContents.capturePage();
      const out = path.join(SCREENSHOT_DIR, shot.file);
      fsx.writeFileSync(out, image.toPNG());
      const size = image.getSize();
      console.log('[screenshot] ' + shot.label + ' -> ' + out + ' (' + size.width + 'x' + size.height + ')');
    }
    console.log('[screenshot] done');
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

    const probe = await mainWindow.webContents.executeJavaScript(
      'JSON.stringify({ api: !!window.sysglance, apiKeys: window.sysglance ? Object.keys(window.sysglance).length : 0, versionText: (document.getElementById("app-version") || {}).textContent || null, suiteFooter: ((document.getElementById("suite-footer") || {}).textContent || "").replace(/\\s+/g, " ").trim() || null, shellSection: !!document.getElementById("sec-shell"), cpu: (document.getElementById("cpu-load") || {}).textContent || null })',
      true
    );
    const state = JSON.parse(probe);
    console.log('[self-test] renderer: ' + probe);
    if (!state.api) fail.push('window.sysglance missing (preload/contextBridge not wired)');
    if (!state.shellSection) fail.push('shell panel did not inject');
    if (!/^v?\d+\.\d+\.\d+/.test(String(state.versionText))) fail.push('version not rendered in the UI');
    if (!state.suiteFooter || !state.suiteFooter.includes(SUITE_FOOTER) || !state.suiteFooter.includes(APP_VERSION)) {
      fail.push('shared suite footer missing or wrong: ' + state.suiteFooter);
    }

    await sleep(400);
    if (rendererErrors.length) fail.push('renderer errors: ' + rendererErrors.join(' | '));

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
