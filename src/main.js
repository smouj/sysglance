const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const si = require('systeminformation');
const shellIpc = require('./shell/ipc');

// ═══════════════════════════════════════════════════════════
// SysGlance — Professional Desktop Overlay System Monitor
// Features: single-instance, tray, config panel, multi-layout,
//           responsive resize, background, auto-position
// ═══════════════════════════════════════════════════════════

// Single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (mainWindow) { if (!mainWindow.isVisible()) mainWindow.show(); mainWindow.focus(); } });

let mainWindow = null;
let tray = null;
let isVisible = true;
let positionLocked = true;
let isQuitting = false;

// Shell section (taskbar geometry, theme, accent, wallpaper, tray blur).
// shellApi is registered in whenReady(); shellState caches the last read so the
// tray menus can show live values (menus are built synchronously).
let shellApi = null;
let shellState = null;
const defaultShell = () => JSON.parse(JSON.stringify(shellIpc.DEFAULT_SHELL));

// Default config
let config = {
  opacity: 0.90,
  refreshInterval: 1500,
  compactMode: false,
  showFilesystem: true,
  theme: 'dark',
  layout: 'sidebar',       // sidebar | dock | corner
  anchor: 'top-right',     // top-right | top-left | bottom-right | bottom-left
  fontSize: 13,             // 11-16
  showSections: {           // toggle visibility per section
    cpu: true, memory: true, gpu: true, filesystem: true,
    disks: true, network: true, processes: true, battery: true
  },
  shell: defaultShell()     // see src/shell/ipc.js DEFAULT_SHELL
};

// ── Config Persistence ────────────────────────────────
const configDir = app.getPath('userData');
const configPath = path.join(configDir, 'config.json');
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...config, ...saved };
      // `shell` is nested, so the flat spread above would replace the whole
      // object and drop keys added later. Merge it (and its blur sub-object).
      const savedShell = saved.shell || {};
      config.shell = { ...defaultShell(), ...savedShell };
      config.shell.taskbarBlur = { ...defaultShell().taskbarBlur, ...(savedShell.taskbarBlur || {}) };
    }
  } catch {}
}
function saveConfig() {
  try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch {}
}

// ── Layout Dimensions ─────────────────────────────────
// Smart sizing based on layout mode and screen
function getLayoutBounds(layout) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;

  switch (layout) {
    case 'dock':      // Bottom bar, full width, thin
      return { w: sw, h: 80, minW: 600, minH: 60, maxW: sw, maxH: 200 };
    case 'corner':   // Small corner widget
      return { w: 220, h: 260, minW: 180, minH: 200, maxW: 300, maxH: 400 };
    case 'sidebar':  // Default side panel
    default:
      return { w: 360, h: 720, minW: 280, minH: 400, maxW: 520, maxH: sh };
  }
}

function getPositionForAnchor(anchor, w, h) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const m = 10;
  switch (anchor) {
    case 'top-left':    return { x: m, y: m };
    case 'bottom-left': return { x: m, y: sh - h - m };
    case 'bottom-right': return { x: sw - w - m, y: sh - h - m };
    case 'top-right':
    default:            return { x: sw - w - m, y: m };
  }
}

// ── Window Creation ──────────────────────────────────
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'overlay', 0);
  if (positionLocked) mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.setBackgroundColor('#00000000');
  mainWindow.setOpacity(config.opacity);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

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

  // Right-click context menu
  mainWindow.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: '🔓 Drag Mode', type: 'checkbox', checked: !positionLocked, click: togglePositionLock },
      { type: 'separator' },
      { label: '📐 Compact', type: 'checkbox', checked: config.compactMode, click: toggleCompact },
      { label: '📁 Filesystem', type: 'checkbox', checked: config.showFilesystem, click: () => { config.showFilesystem = !config.showFilesystem; sendConfig(); } },
      { type: 'separator' },
      { label: 'Layout', submenu: [
        { label: 'Sidebar (default)', type: 'radio', checked: config.layout === 'sidebar', click: () => setLayout('sidebar') },
        { label: 'Dock (bottom)', type: 'radio', checked: config.layout === 'dock', click: () => setLayout('dock') },
        { label: 'Corner (mini)', type: 'radio', checked: config.layout === 'corner', click: () => setLayout('corner') },
      ]},
      { label: 'Position', submenu: [
        { label: 'Top-Right', click: () => setAnchor('top-right') },
        { label: 'Top-Left', click: () => setAnchor('top-left') },
        { label: 'Bottom-Right', click: () => setAnchor('bottom-right') },
        { label: 'Bottom-Left', click: () => setAnchor('bottom-left') },
      ]},
      { label: 'Theme', submenu: [
        { label: '🌙 Dark', type: 'radio', checked: config.theme === 'dark', click: () => setTheme('dark') },
        { label: '☀️ Light', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') },
      ]},
      { label: '🪟 Shell', submenu: buildShellSubmenu() },
      { type: 'separator' },
      { label: '⚙️ Settings Panel', click: () => mainWindow?.webContents.send('toggle-settings') },
      { type: 'separator' },
      { label: '❌ Quit', click: () => { isQuitting = true; app.quit(); } }
    ]).popup();
  });
}

// ── Tray ──────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  try { trayIcon = nativeImage.createFromPath(iconPath); if (trayIcon.isEmpty()) throw new Error(); }
  catch { trayIcon = nativeImage.createFromBuffer(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x10,0x08,0x06,0x00,0x00,0x00,0x31,0xF7,0x2E,0x7A,0x00,0x00,0x00,0x01,0x73,0x52,0x47,0x42,0x00,0xAE,0xCE,0x1C,0xE9,0x00,0x00,0x00,0x04,0x67,0x41,0x4D,0x41,0x00,0x00,0xB1,0x8F,0x0B,0xFC,0x61,0x05,0x00,0x00,0x00,0x09,0x70,0x48,0x59,0x73,0x00,0x00,0x0E,0xC3,0x00,0x00,0x0E,0xC3,0x01,0xC7,0x6F,0xA8,0x64,0x00,0x00,0x00,0x18,0x49,0x44,0x41,0x54,0x38,0x4F,0x63,0x60,0x18,0x15,0x30,0x06,0x64,0x18,0x14,0x0C,0x42,0x03,0xA6,0x01,0x14,0x00,0x01,0x63,0x08,0x30,0x7A,0x5E,0x49,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82])); }
  tray = new Tray(trayIcon);
  tray.setToolTip('SysGlance');
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
    { label: '📁 Filesystem', type: 'checkbox', checked: config.showFilesystem, click: () => { config.showFilesystem = !config.showFilesystem; sendConfig(); rebuildTray(); } },
    { type: 'separator' },
    { label: 'Layout', submenu: [
      { label: 'Sidebar', type: 'radio', checked: config.layout === 'sidebar', click: () => setLayout('sidebar') },
      { label: 'Dock', type: 'radio', checked: config.layout === 'dock', click: () => setLayout('dock') },
      { label: 'Corner', type: 'radio', checked: config.layout === 'corner', click: () => setLayout('corner') },
    ]},
    { label: 'Position', submenu: [
      { label: 'Top-Right', type: 'radio', checked: config.anchor === 'top-right', click: () => setAnchor('top-right') },
      { label: 'Top-Left', type: 'radio', checked: config.anchor === 'top-left', click: () => setAnchor('top-left') },
      { label: 'Bottom-Right', type: 'radio', checked: config.anchor === 'bottom-right', click: () => setAnchor('bottom-right') },
      { label: 'Bottom-Left', type: 'radio', checked: config.anchor === 'bottom-left', click: () => setAnchor('bottom-left') },
    ]},
    { label: 'Theme', submenu: [
      { label: '🌙 Dark', type: 'radio', checked: config.theme === 'dark', click: () => setTheme('dark') },
      { label: '☀️ Light', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') },
    ]},
    { label: '🪟 Shell', submenu: buildShellSubmenu() },
    { type: 'separator' },
    { label: '⚙️ Settings Panel', click: () => mainWindow?.webContents.send('toggle-settings') },
    { type: 'separator' },
    { label: '❌ Quit SysGlance', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

// ── Shell (taskbar / theme / accent / wallpaper / blur) ─
// Wires src/shell/ipc.js in. The window and config are injected so this file
// keeps owning persistence, exactly like the rest of the app.
function registerShell() {
  try {
    shellApi = shellIpc.register({
      getWindow: () => mainWindow,
      getConfig: () => config,
      saveConfig,
      log: (m) => console.warn('[shell]', m)
    });
  } catch (err) {
    console.error('[shell] registration failed:', err.message);
    shellApi = null;
  }
}

async function refreshShellState() {
  if (!shellApi) return;
  try { shellState = await shellApi.state(); } catch { shellState = null; }
  rebuildTray();
}

// Runs a shell action from a menu, reports the outcome in the app log and
// refreshes the cached state so the menus show live values.
async function runShellAction(label, fn) {
  if (!shellApi) { console.error('[shell] ' + label + ': shell IPC not available'); return; }
  try {
    const r = await fn();
    if (r && r.ok === false) console.error('[shell] ' + label + ' failed: ' + (r.error || 'unknown error'));
    else if (r && r.changed && r.restartRequired) console.warn('[shell] ' + label + ' ok — explorer.exe restart required to apply');
    else console.log('[shell] ' + label + ' ok');
  } catch (err) {
    console.error('[shell] ' + label + ' threw: ' + err.message);
  }
  refreshShellState();
}

// Shared by the tray menu and the window context menu.
function buildShellSubmenu() {
  const s = config.shell || {};
  const tb = (shellState && shellState.taskbar && shellState.taskbar.ok) ? shellState.taskbar : null;
  const blurRunning = !!(shellState && shellState.blur && shellState.blur.running);
  const blurOpts = { acrylic: !!(s.taskbarBlur && s.taskbarBlur.acrylic), tint: (s.taskbarBlur && s.taskbarBlur.tint) || null };
  const now = tb ? ' (now: ' + tb.position + ')' : '';
  return [
    { label: 'Taskbar position' + now, submenu: [
      { label: 'Left', type: 'radio', checked: !!tb && tb.positionIndex === 0, click: () => runShellAction('taskbar position=left', () => shellApi.setPosition('left')) },
      { label: 'Top', type: 'radio', checked: !!tb && tb.positionIndex === 1, click: () => runShellAction('taskbar position=top', () => shellApi.setPosition('top')) },
      { label: 'Right', type: 'radio', checked: !!tb && tb.positionIndex === 2, click: () => runShellAction('taskbar position=right', () => shellApi.setPosition('right')) },
      { label: 'Bottom', type: 'radio', checked: !!tb && tb.positionIndex === 3, click: () => runShellAction('taskbar position=bottom', () => shellApi.setPosition('bottom')) },
    ]},
    { label: 'Auto-hide taskbar' + (tb ? ' (' + (tb.autoHide ? 'on' : 'off') + ')' : ''), type: 'checkbox', checked: tb ? tb.autoHide : !!s.autoHide, click: (item) => runShellAction('auto-hide=' + item.checked, () => shellApi.setAutoHide(item.checked)) },
    { type: 'separator' },
    { label: 'Dark mode', type: 'checkbox', checked: s.darkMode !== false, click: (item) => runShellAction('dark=' + item.checked, () => shellApi.setDark(item.checked)) },
    { label: 'Accent from wallpaper', click: () => runShellAction('accent from wallpaper', () => shellApi.accentAuto()) },
    { label: 'Re-apply saved wallpaper', enabled: !!s.wallpaperPath, click: () => runShellAction('wallpaper', () => shellApi.applyWallpaper(s.wallpaperPath)) },
    { type: 'separator' },
    { label: 'Taskbar blur', submenu: [
      { label: 'Apply once', click: () => runShellAction('blur apply', () => shellApi.blur.apply(blurOpts)) },
      { label: 'Start resident watcher', click: () => runShellAction('blur start', () => shellApi.blur.start(blurOpts)) },
      { label: 'Stop', enabled: blurRunning, click: () => runShellAction('blur stop', () => shellApi.blur.stop()) },
      { label: blurRunning ? 'Status: running' : 'Status: stopped', enabled: false },
    ]},
    { type: 'separator' },
    { label: '⟳ Restart Explorer (apply taskbar changes)', click: () => runShellAction('restart explorer', () => shellApi.restartExplorer()) },
    { label: tb ? 'Shell: ' + tb.position + ', autohide ' + (tb.autoHide ? 'on' : 'off') : 'Shell: state unavailable', enabled: false }
  ];
}

// ── Actions ───────────────────────────────────────────
function toggleVisibility() {
  if (!mainWindow) return;
  isVisible = !isVisible;
  if (isVisible) { mainWindow.show(); mainWindow.setIgnoreMouseEvents(positionLocked, { forward: true }); }
  else mainWindow.hide();
  mainWindow.webContents.send('visibility-changed', isVisible);
}

function togglePositionLock() {
  positionLocked = !positionLocked;
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(positionLocked, { forward: true });
    mainWindow.setFocusable(!positionLocked);
    mainWindow.setAlwaysOnTop(true, positionLocked ? 'overlay' : 'floating', 0);
  }
  mainWindow?.webContents.send('position-lock-changed', positionLocked);
  saveConfig(); rebuildTray();
}

function toggleCompact() {
  config.compactMode = !config.compactMode;
  sendConfig(); saveConfig(); rebuildTray();
}

function setTheme(t) { config.theme = t; sendConfig(); saveConfig(); rebuildTray(); }

function setAnchor(a) {
  config.anchor = a;
  if (mainWindow) {
    const [w, h] = mainWindow.getSize();
    const pos = getPositionForAnchor(a, w, h);
    mainWindow.setPosition(pos.x, pos.y);
  }
  sendConfig(); saveConfig(); rebuildTray();
}

function setLayout(layout) {
  config.layout = layout;
  if (mainWindow) {
    const bounds = getLayoutBounds(layout);
    mainWindow.setMinimumSize(bounds.minW, bounds.minH);
    mainWindow.setMaximumSize(bounds.maxW, bounds.maxH);
    mainWindow.setSize(bounds.w, bounds.h);
    const pos = getPositionForAnchor(config.anchor, bounds.w, bounds.h);
    mainWindow.setPosition(pos.x, pos.y);
  }
  sendConfig(); saveConfig(); rebuildTray();
  // Notify renderer to re-layout
  mainWindow?.webContents.send('layout-changed', layout);
}

function sendConfig() { mainWindow?.webContents.send('config-changed', config); }

// ── Static Data Cache ────────────────────────────────
let staticCache = null, staticCacheTime = 0;
async function getStaticData() {
  const now = Date.now();
  if (staticCache && (now - staticCacheTime) < 30000) return staticCache;
  const [cpu, osData, gpuData] = await Promise.all([si.cpu().catch(() => ({})), si.osInfo().catch(() => ({})), si.graphics().catch(() => ({}))]);
  staticCache = { cpu, os: osData, gpu: gpuData };
  staticCacheTime = now;
  return staticCache;
}

// ── System Data Collection ────────────────────────────
let dataInterval = null;

async function collectSystemData() {
  try {
    const [cpuLoad, mem, netData, diskData, processes, temps, batData, timeData] = await Promise.all([
      si.currentLoad(), si.mem(), si.networkStats(), si.fsSize(),
      si.processes(), si.cpuTemperature().catch(() => ({})),
      si.battery().catch(() => ({})), si.time()
    ]);
    const s = await getStaticData();
    const topProcs = (processes.list || []).sort((a, b) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 8)
      .map(p => ({ name: (p.name || '?').substring(0, 18), pid: p.pid, cpu: +(p.cpu || 0).toFixed(1), mem: +(p.mem || 0).toFixed(1) }));
    const activeNet = (netData || []).find(n => n.rx_sec > 0 || n.tx_sec > 0) || netData?.[0] || {};
    const disks = diskData.map(d => ({ fs: d.fs || '?', mount: d.mount || '?', used: d.used || 0, size: d.size || 0, use: d.use !== undefined ? +d.use.toFixed(1) : 0, available: d.available || 0 })).filter(d => d.size > 0).slice(0, 8);
    const gpus = (s.gpu?.controllers || []).map((g, i) => ({ name: (g.model || 'GPU').substring(0, 36), utilization: g.utilization ?? null, vram: g.vram ?? null, vramUsed: g.memoryUsed ?? null, temp: temps?.[i] ?? null }));
    const homeDir = os.homedir();
    const folderDefs = [{ n: 'Desktop', i: '🖥️' }, { n: 'Documents', i: '📄' }, { n: 'Downloads', i: '📥' }, { n: 'Pictures', i: '🖼️' }, { n: 'Videos', i: '🎬' }, { n: 'Music', i: '🎵' }];
    const folders = [];
    for (const f of folderDefs) { try { const p = path.join(homeDir, f.n); fs.accessSync(p, fs.constants.R_OK); let c = 0; try { c = fs.readdirSync(p).length; } catch {} folders.push({ name: f.n, icon: f.i, path: p, count: c }); } catch {} }

    return {
      timestamp: Date.now(),
      layout: config.layout,
      cpu: { model: ((s.cpu?.manufacturer || '') + ' ' + (s.cpu?.brand || 'CPU')).trim().substring(0, 44), cores: cpuLoad.cpus?.length || os.cpus().length, load: +(cpuLoad.currentLoad || 0).toFixed(1), temp: temps.main || null, perCore: (cpuLoad.cpus || []).map(c => +(c.load || 0).toFixed(1)).slice(0, 32) },
      memory: { total: mem.total, used: mem.used, free: mem.free, swapTotal: mem.swaptotal, swapUsed: mem.swapused, percentage: mem.total > 0 ? +((mem.used / mem.total) * 100).toFixed(1) : 0 },
      gpu: gpus.length > 0 ? gpus : null, disks,
      network: { iface: activeNet.iface || '?', rx_sec: activeNet.rx_sec || 0, tx_sec: activeNet.tx_sec || 0 },
      processes: topProcs,
      os: { distro: s.os?.distro || '?', release: s.os?.release || '?', hostname: s.os?.hostname || '?', arch: s.os?.arch || '?', uptime: timeData.uptime || 0 },
      filesystem: { home: homeDir, folders },
      battery: batData.hasBattery ? { percent: batData.percent || 0, charging: batData.charging || false, acConnected: batData.acConnected || false } : null,
      config
    };
  } catch (err) { return { error: err.message, timestamp: Date.now() }; }
}

async function broadcastSystemData() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('system-data', await collectSystemData()); } catch {}
}

function startDataCollection() {
  if (dataInterval) clearInterval(dataInterval);
  broadcastSystemData();
  dataInterval = setInterval(broadcastSystemData, config.refreshInterval);
}

// ── IPC ───────────────────────────────────────────────
ipcMain.handle('get-system-data', collectSystemData);
ipcMain.on('set-opacity', (_e, v) => { config.opacity = Math.max(0.2, Math.min(1, v)); mainWindow?.setOpacity(config.opacity); saveConfig(); });
ipcMain.on('toggle-position-lock', () => togglePositionLock());
ipcMain.on('toggle-visibility', () => toggleVisibility());
ipcMain.on('set-config', (_e, k, v) => { config[k] = v; sendConfig(); saveConfig(); rebuildTray(); });
ipcMain.on('set-layout', (_e, l) => setLayout(l));
ipcMain.on('set-anchor', (_e, a) => setAnchor(a));
ipcMain.on('set-theme', (_e, t) => setTheme(t));
ipcMain.on('open-folder', (_e, p) => { shell.openPath(p).catch(() => {}); });
ipcMain.on('quit-app', () => { isQuitting = true; app.quit(); });

// ── App Lifecycle ─────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  createWindow();
  registerShell();          // before createTray(): the tray menu reads shell config
  createTray();
  startDataCollection();
  refreshShellState();      // async; refreshes the tray labels once it lands
  globalShortcut.register('CommandOrControl+Shift+S', toggleVisibility);
  globalShortcut.register('CommandOrControl+Shift+L', togglePositionLock);
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  saveConfig();
  globalShortcut.unregisterAll();
  // Never leave the resident blur watcher running invisibly after a quit.
  try { if (shellApi && shellState && shellState.blur && shellState.blur.running) shellApi.blur.stop(); } catch {}
});
app.on('will-quit', () => { if (dataInterval) clearInterval(dataInterval); });
