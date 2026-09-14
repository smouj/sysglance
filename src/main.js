const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const si = require('systeminformation');

// ═══════════════════════════════════════════════════════
// SysGlance — Desktop Overlay System Monitor
// Professional: single-instance, auto-start, tray, context menu
// ═══════════════════════════════════════════════════════

// ── Single Instance ──────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (mainWindow) { if (!mainWindow.isVisible()) mainWindow.show(); mainWindow.focus(); } });

// ── State ────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isVisible = true;
let positionLocked = true;
let isQuitting = false;

let config = {
  opacity: 0.88,
  position: { x: -1, y: -1 },
  anchor: 'top-right',
  refreshInterval: 1500,
  compactMode: false,
  showFilesystem: true,
  theme: 'dark'
};

// ── Config Persistence ───────────────────────────────────
const configDir = app.getPath('userData');
const configPath = path.join(configDir, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...config, ...saved };
    }
  } catch { /* use defaults */ }
}

function saveConfig() {
  try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch {}
}

// ── Static Data Cache ─────────────────────────────────────
let staticCache = null;
let staticCacheTime = 0;
const STATIC_TTL = 30000; // 30s — CPU model/OS rarely change

async function getStaticData() {
  const now = Date.now();
  if (staticCache && (now - staticCacheTime) < STATIC_TTL) return staticCache;
  const [cpu, osData, gpuData] = await Promise.all([
    si.cpu().catch(() => ({})),
    si.osInfo().catch(() => ({})),
    si.graphics().catch(() => ({}))
  ]);
  staticCache = { cpu, os: osData, gpu: gpuData };
  staticCacheTime = now;
  return staticCache;
}

// ── Window Creation ──────────────────────────────────────
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const defaultW = 380;
  const defaultH = 740;

  // Calculate position from anchor or saved config
  let posX, posY;
  if (config.position.x >= 0 && config.position.y >= 0) {
    posX = config.position.x;
    posY = config.position.y;
  } else {
    const positions = {
      'top-right': { x: sw - defaultW - 12, y: 12 },
      'top-left': { x: 12, y: 12 },
      'bottom-right': { x: sw - defaultW - 12, y: sh - defaultH - 12 },
      'bottom-left': { x: 12, y: sh - defaultH - 12 }
    };
    const pos = positions[config.anchor] || positions['top-right'];
    posX = pos.x;
    posY = pos.y;
  }

  mainWindow = new BrowserWindow({
    width: defaultW,
    height: defaultH,
    minWidth: 300,
    minHeight: 420,
    maxWidth: 520,
    maxHeight: 1000,
    x: posX,
    y: posY,
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
      backgroundThrottling: false  // Keep updating when unfocused
    }
  });

  // Always visible on all workspaces and fullscreen
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'overlay', 0);

  // Overlay mode: click-through when locked
  if (positionLocked) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  mainWindow.setBackgroundColor('#00000000');
  mainWindow.setOpacity(config.opacity);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Hide to tray on close, don't quit
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      isVisible = false;
    }
  });

  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const pos = mainWindow.getPosition();
      config.position = { x: pos[0], y: pos[1] };
      saveConfig();
    }
  });

  mainWindow.on('resized', () => {
    if (mainWindow && !mainWindow.isDestroyed() && positionLocked) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // Right-click context menu
  mainWindow.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: '🔓 Lock / Unlock Position', click: togglePositionLock },
      { label: '📐 Compact Mode', type: 'checkbox', checked: config.compactMode, click: toggleCompact },
      { label: '📁 Show Filesystem', type: 'checkbox', checked: config.showFilesystem, click: () => { config.showFilesystem = !config.showFilesystem; mainWindow?.webContents.send('config-changed', config); saveConfig(); rebuildTrayMenu(); } },
      { type: 'separator' },
      { label: 'Theme', submenu: [
        { label: '🌙 Dark', type: 'radio', checked: config.theme === 'dark', click: () => setTheme('dark') },
        { label: '☀️ Light', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') },
      ]},
      { label: 'Position', submenu: [
        { label: 'Top-Right', click: () => setAnchor('top-right') },
        { label: 'Top-Left', click: () => setAnchor('top-left') },
        { label: 'Bottom-Right', click: () => setAnchor('bottom-right') },
        { label: 'Bottom-Left', click: () => setAnchor('bottom-left') },
      ]},
      { type: 'separator' },
      { label: '🔄 Refresh Now', click: () => broadcastSystemData() },
      { type: 'separator' },
      { label: '❌ Quit SysGlance', click: () => { isQuitting = true; app.quit(); } }
    ]).popup();
  });
}

// ── System Tray ───────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('no icon');
  } catch {
    // Minimal fallback icon (16x16 cyan dot)
    trayIcon = nativeImage.createFromBuffer(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x10,0x08,0x06,0x00,0x00,0x00,0x31,0xF7,0x2E,0x7A,0x00,0x00,0x00,0x01,0x73,0x52,0x47,0x42,0x00,0xAE,0xCE,0x1C,0xE9,0x00,0x00,0x00,0x04,0x67,0x41,0x4D,0x41,0x00,0x00,0xB1,0x8F,0x0B,0xFC,0x61,0x05,0x00,0x00,0x00,0x09,0x70,0x48,0x59,0x73,0x00,0x00,0x0E,0xC3,0x00,0x00,0x0E,0xC3,0x01,0xC7,0x6F,0xA8,0x64,0x00,0x00,0x00,0x18,0x49,0x44,0x41,0x54,0x38,0x4F,0x63,0x60,0x18,0x15,0x30,0x06,0x64,0x18,0x14,0x0C,0x42,0x03,0xA6,0x01,0x14,0x00,0x01,0x63,0x08,0x30,0x7A,0x5E,0x49,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]));
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('SysGlance — System Monitor');
  rebuildTrayMenu();
  tray.on('double-click', toggleVisibility);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '👁 Show / Hide', accelerator: 'Ctrl+Shift+S', click: toggleVisibility },
    { type: 'separator' },
    { label: '🔓 Drag Mode (Unlock)', type: 'checkbox', checked: !positionLocked, click: togglePositionLock },
    { label: '📐 Compact Mode', type: 'checkbox', checked: config.compactMode, click: toggleCompact },
    { label: '📁 Filesystem Panel', type: 'checkbox', checked: config.showFilesystem, click: () => { config.showFilesystem = !config.showFilesystem; mainWindow?.webContents.send('config-changed', config); saveConfig(); rebuildTrayMenu(); } },
    { type: 'separator' },
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
    { type: 'separator' },
    { label: '🔄 Refresh Now', click: () => broadcastSystemData() },
    { type: 'separator' },
    { label: '❌ Quit SysGlance', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

// ── Toggle Functions ──────────────────────────────────────
function toggleVisibility() {
  if (!mainWindow) return;
  isVisible = !isVisible;
  if (isVisible) {
    mainWindow.show();
    mainWindow.setIgnoreMouseEvents(positionLocked, { forward: true });
  } else {
    mainWindow.hide();
  }
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
  saveConfig();
  rebuildTrayMenu();
}

function toggleCompact() {
  config.compactMode = !config.compactMode;
  mainWindow?.webContents.send('compact-mode-changed', config.compactMode);
  saveConfig();
  rebuildTrayMenu();
}

function setTheme(theme) {
  config.theme = theme;
  mainWindow?.webContents.send('theme-changed', theme);
  saveConfig();
  rebuildTrayMenu();
}

function setAnchor(anchor) {
  config.anchor = anchor;
  if (mainWindow) {
    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = display.workAreaSize;
    const [w, h] = mainWindow.getSize();
    const positions = {
      'top-right': { x: sw - w - 12, y: 12 },
      'top-left': { x: 12, y: 12 },
      'bottom-right': { x: sw - w - 12, y: sh - h - 12 },
      'bottom-left': { x: 12, y: sh - h - 12 }
    };
    const pos = positions[anchor] || positions['top-right'];
    mainWindow.setPosition(pos.x, pos.y);
    config.position = pos;
  }
  saveConfig();
  rebuildTrayMenu();
}

// ── System Data Collection (optimized with caching) ───────
let dataInterval = null;

async function collectSystemData() {
  try {
    // Parallel data fetch — dynamic data
    const [cpuLoad, mem, netData, diskData, processes, temps, batData, timeData] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats(),
      si.fsSize(),
      si.processes(),
      si.cpuTemperature().catch(() => ({})),
      si.battery().catch(() => ({})),
      si.time()
    ]);

    // Static data from cache
    const staticData = await getStaticData();

    // Top 8 by CPU
    const topProcs = (processes.list || [])
      .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
      .slice(0, 8)
      .map(p => ({ name: (p.name || '?').substring(0, 18), pid: p.pid, cpu: +(p.cpu || 0).toFixed(1), mem: +(p.mem || 0).toFixed(1) }));

    // Active network interface
    const activeNet = (netData || []).find(n => n.rx_sec > 0 || n.tx_sec > 0) || netData?.[0] || {};

    // Disk usage
    const disks = diskData.map(d => ({
      fs: d.fs || '?', mount: d.mount || '?', used: d.used || 0,
      size: d.size || 0, use: d.use !== undefined ? +d.use.toFixed(1) : 0, available: d.available || 0
    })).filter(d => d.size > 0).slice(0, 8);

    // GPU
    const gpus = (staticData.gpu?.controllers || []).map((g, i) => ({
      name: (g.model || 'GPU').substring(0, 36),
      utilization: g.utilization ?? null, vram: g.vram ?? null,
      vramUsed: g.memoryUsed ?? null, temp: temps?.[i] ?? null
    }));

    // User folders (filesystem panel)
    const homeDir = os.homedir();
    const folderDefs = [
      { name: 'Desktop', icon: '🖥️' }, { name: 'Documents', icon: '📄' },
      { name: 'Downloads', icon: '📥' }, { name: 'Pictures', icon: '🖼️' },
      { name: 'Videos', icon: '🎬' }, { name: 'Music', icon: '🎵' }
    ];
    const folders = [];
    for (const f of folderDefs) {
      try {
        const fpath = path.join(homeDir, f.name);
        fs.accessSync(fpath, fs.constants.R_OK);
        let fileCount = 0;
        try { fileCount = fs.readdirSync(fpath).length; } catch {}
        folders.push({ name: f.name, icon: f.icon, path: fpath, count: fileCount });
      } catch {}
    }

    return {
      timestamp: Date.now(),
      cpu: {
        model: (staticData.cpu?.manufacturer ? staticData.cpu.manufacturer + ' ' : '') + (staticData.cpu?.brand || 'CPU'),
        cores: cpuLoad.cpus?.length || os.cpus().length,
        load: +(cpuLoad.currentLoad || 0).toFixed(1),
        temp: temps.main || null,
        perCore: (cpuLoad.cpus || []).map(c => +(c.load || 0).toFixed(1)).slice(0, 24)
      },
      memory: {
        total: mem.total, used: mem.used, free: mem.free,
        swapTotal: mem.swaptotal, swapUsed: mem.swapused,
        percentage: mem.total > 0 ? +((mem.used / mem.total) * 100).toFixed(1) : 0
      },
      gpu: gpus.length > 0 ? gpus : null,
      disks,
      network: { iface: activeNet.iface || '?', rx_sec: activeNet.rx_sec || 0, tx_sec: activeNet.tx_sec || 0 },
      processes: topProcs,
      os: {
        distro: staticData.os?.distro || '?', release: staticData.os?.release || '?',
        hostname: staticData.os?.hostname || '?', arch: staticData.os?.arch || '?',
        uptime: timeData.uptime || 0
      },
      filesystem: { home: homeDir, folders },
      battery: batData.hasBattery ? {
        percent: batData.percent || 0, charging: batData.charging || false,
        acConnected: batData.acConnected || false
      } : null
    };
  } catch (err) {
    console.error('Data error:', err.message);
    return { error: err.message, timestamp: Date.now() };
  }
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

// ── IPC Handlers ──────────────────────────────────────────
ipcMain.handle('get-system-data', collectSystemData);
ipcMain.on('set-opacity', (_e, v) => { config.opacity = Math.max(0.2, Math.min(1, v)); mainWindow?.setOpacity(config.opacity); saveConfig(); });
ipcMain.on('set-position', (_e, pos) => { config.position = pos; mainWindow?.setPosition(pos.x, pos.y); saveConfig(); });
ipcMain.on('toggle-position-lock', () => togglePositionLock());
ipcMain.on('toggle-visibility', () => toggleVisibility());
ipcMain.on('set-config', (_e, k, v) => { config[k] = v; saveConfig(); mainWindow?.webContents.send('config-changed', config); });
ipcMain.on('set-anchor', (_e, a) => setAnchor(a));
ipcMain.on('toggle-compact', () => toggleCompact());
ipcMain.on('set-theme', (_e, t) => setTheme(t));
ipcMain.on('open-folder', (_e, p) => { shell.openPath(p).catch(() => {}); });
ipcMain.on('quit-app', () => { isQuitting = true; app.quit(); });

// ── App Lifecycle ────────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();
  startDataCollection();
  globalShortcut.register('CommandOrControl+Shift+S', toggleVisibility);
  globalShortcut.register('CommandOrControl+Shift+L', togglePositionLock);
});

app.on('second-instance', () => { if (mainWindow) { if (!mainWindow.isVisible()) mainWindow.show(); mainWindow.focus(); } });
app.on('window-all-closed', () => {}); // Keep running in tray
app.on('before-quit', () => { isQuitting = true; saveConfig(); globalShortcut.unregisterAll(); });
app.on('will-quit', () => { if (dataInterval) clearInterval(dataInterval); });
