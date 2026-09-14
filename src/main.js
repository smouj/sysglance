const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const si = require('systeminformation');

// ── State ──────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isDev = process.argv.includes('--dev');
let isVisible = true;
let positionLocked = true; // locked = overlay mode, unlocked = draggable
let config = {
  opacity: 0.88,
  position: { x: 20, y: 20 },
  anchor: 'top-left', // top-left | top-right | bottom-left | bottom-right
  refreshInterval: 1500, // ms
  compactMode: false,
  showGpu: true,
  showNetwork: true,
  showDisks: true,
  showProcesses: true,
  accentColor: '#00e5ff',
  theme: 'dark' // dark | light
};

// ── Window Creation ────────────────────────────────────
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width: 380,
    height: 680,
    minWidth: 300,
    minHeight: 400,
    maxWidth: 600,
    maxHeight: 900,
    x: config.position.x,
    y: config.position.y,
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
      enableRemoteModule: false
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'overlay', 0);
  mainWindow.setIgnoreMouseEvents(!isVisible);
  mainWindow.setBackgroundColor('#00000000');
  mainWindow.setOpacity(config.opacity);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (positionLocked) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // Close = hide to tray
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      isVisible = false;
    }
  });

  mainWindow.on('moved', () => {
    if (mainWindow) {
      const pos = mainWindow.getPosition();
      config.position = { x: pos[0], y: pos[1] };
      saveConfig();
    }
  });

  mainWindow.on('resized', () => {
    if (mainWindow && positionLocked) {
      // Re-apply overlay mode after resize
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });
}

// ── System Tray ────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('no icon');
  } catch {
    // Fallback: create a minimal 16x16 pixel icon
    trayIcon = nativeImage.createFromBuffer(
      Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x31, 0xF7, 0x2E, 0x7A, 0x00, 0x00, 0x00,
        0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xAE, 0xCE, 0x1C, 0xE9, 0x00, 0x00,
        0x00, 0x04, 0x67, 0x41, 0x4D, 0x41, 0x00, 0x00, 0xB1, 0x8F, 0x0B, 0xFC,
        0x61, 0x05, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00,
        0x0E, 0xC3, 0x00, 0x00, 0x0E, 0xC3, 0x01, 0xC7, 0x6F, 0xA8, 0x64, 0x00,
        0x00, 0x00, 0x18, 0x49, 0x44, 0x41, 0x54, 0x38, 0x4F, 0x63, 0x60, 0x18,
        0x15, 0x30, 0x06, 0x64, 0x18, 0x14, 0x0C, 0x42, 0x03, 0xA6, 0x01, 0x14,
        0x00, 0x01, 0x63, 0x08, 0x30, 0x7A, 0x5E, 0x49, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ])
    );
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('SysGlance — System Monitor Overlay');

  const contextMenu = Menu.buildFromTemplate([
    { label: '👁 Show / Hide', click: toggleVisibility },
    { type: 'separator' },
    { label: '🔓 Unlock Position (Drag)', type: 'checkbox', checked: !positionLocked, click: togglePositionLock },
    { label: '📐 Compact Mode', type: 'checkbox', checked: config.compactMode, click: toggleCompact },
    { type: 'separator' },
    { label: '🔄 Refresh Data', click: () => broadcastSystemData() },
    { type: 'separator' },
    { label: '🌙 Dark Theme', type: 'radio', checked: config.theme === 'dark', click: () => setTheme('dark') },
    { label: '☀️ Light Theme', type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') },
    { type: 'separator' },
    { label: '❌ Quit SysGlance', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', toggleVisibility);
}

// ── Config Persistence ─────────────────────────────────
const fs = require('fs');
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...config, ...saved };
    }
  } catch { /* use defaults */ }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch { /* silent */ }
}

// ── Toggle Functions ───────────────────────────────────
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
    if (!positionLocked) {
      mainWindow.setAlwaysOnTop(true, 'floating', 0);
    } else {
      mainWindow.setAlwaysOnTop(true, 'overlay', 0);
    }
  }
  mainWindow.webContents.send('position-lock-changed', positionLocked);
  saveConfig();
}

function toggleCompact() {
  config.compactMode = !config.compactMode;
  mainWindow.webContents.send('compact-mode-changed', config.compactMode);
  saveConfig();
}

function setTheme(theme) {
  config.theme = theme;
  mainWindow.webContents.send('theme-changed', theme);
  saveConfig();
}

// ── System Data Collection ──────────────────────────────
let dataInterval = null;

async function collectSystemData() {
  try {
    const [
      cpu, cpuTemp, cpuSpeed,
      mem,
      gpuData, gpuTemp,
      diskData,
      netData,
      processes,
      osData,
      uptime,
      batData
    ] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature().catch(() => ({})),
      si.cpuCurrentSpeed().catch(() => ({})),
      si.mem(),
      si.graphics().catch(() => ({})),
      si.gpuTemperature().catch ? si.gpuTemperature().catch(() => ({})) : Promise.resolve({}),
      si.fsSize(),
      si.networkStats(),
      si.processes(),
      si.osInfo(),
      si.time(),
      si.battery().catch(() => ({}))
    ]);

    // Process top 8 by CPU
    const topProcs = (processes.list || [])
      .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
      .slice(0, 8)
      .map(p => ({
        name: (p.name || 'unknown').substring(0, 16),
        pid: p.pid,
        cpu: +(p.cpu || 0).toFixed(1),
        mem: +(p.mem || 0).toFixed(1)
      }));

    // Network - find active interface
    const activeNet = (netData || []).find(n => n.rx_sec > 0 || n.tx_sec > 0) || netData?.[0] || {};

    // Disk usage
    const disks = diskData.map(d => ({
      fs: d.fs || d.mount || '?',
      used: d.used || 0,
      size: d.size || 0,
      use: d.use !== undefined ? +d.use.toFixed(1) : 0,
      available: d.available || 0
    })).filter(d => d.size > 0).slice(0, 6);

    // GPU data
    const gpus = (gpuData.controllers || []).map((g, i) => ({
      name: (g.model || 'GPU').substring(0, 30),
      utilization: g.utilization !== undefined ? g.utilization : null,
      vram: g.vram !== undefined ? g.vram : null,
      vramUsed: g.memoryUsed !== undefined ? g.memoryUsed : null,
      temp: (gpuTemp && gpuTemp[i]) ? gpuTemp[i] : null
    }));

    return {
      timestamp: Date.now(),
      cpu: {
        model: (osData.cpu || cpu.cpu?.model || 'CPU').substring(0, 36),
        cores: cpu.cpus?.length || osData.cpuCores || 0,
        load: +(cpu.currentLoad || 0).toFixed(1),
        temp: cpuTemp.main || null,
        speed: cpuSpeed.avg || null,
        perCore: (cpu.cpus || []).map(c => +(c.load || 0).toFixed(1)).slice(0, 16)
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        percentage: mem.total > 0 ? +((mem.used / mem.total) * 100).toFixed(1) : 0
      },
      gpu: gpus.length > 0 ? gpus : null,
      disks,
      network: {
        iface: activeNet.iface || '?',
        rx_sec: activeNet.rx_sec || 0,
        tx_sec: activeNet.tx_sec || 0,
        rx_bytes: activeNet.rx_bytes || 0,
        tx_bytes: activeNet.tx_bytes || 0
      },
      processes: topProcs,
      os: {
        platform: osData.platform || '?',
        distro: osData.distro || '?',
        release: osData.release || '?',
        kernel: osData.kernel || '?',
        arch: osData.arch || '?',
        hostname: osData.hostname || '?',
        uptime: uptime.uptime || 0
      },
      battery: batData.hasBattery ? {
        percent: batData.percent || 0,
        charging: batData.charging || false,
        acConnected: batData.acConnected || false
      } : null
    };
  } catch (err) {
    console.error('System data collection error:', err.message);
    return { error: err.message, timestamp: Date.now() };
  }
}

async function broadcastSystemData() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const data = await collectSystemData();
  mainWindow.webContents.send('system-data', data);
}

function startDataCollection() {
  if (dataInterval) clearInterval(dataInterval);
  broadcastSystemData(); // immediate first tick
  dataInterval = setInterval(broadcastSystemData, config.refreshInterval);
}

// ── IPC Handlers ───────────────────────────────────────
ipcMain.handle('get-system-data', collectSystemData);

ipcMain.on('set-opacity', (_e, opacity) => {
  config.opacity = Math.max(0.2, Math.min(1, opacity));
  mainWindow?.setOpacity(config.opacity);
  saveConfig();
});

ipcMain.on('set-position', (_e, pos) => {
  config.position = pos;
  mainWindow?.setPosition(pos.x, pos.y);
  saveConfig();
});

ipcMain.on('toggle-position-lock', () => togglePositionLock());
ipcMain.on('toggle-visibility', () => toggleVisibility());

ipcMain.on('set-config', (_e, key, value) => {
  config[key] = value;
  saveConfig();
  mainWindow?.webContents.send('config-changed', config);
});

ipcMain.on('set-anchor', (_e, anchor) => {
  config.anchor = anchor;
  if (mainWindow) {
    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = display.workAreaSize;
    const [w, h] = mainWindow.getSize();
    let x, y;
    switch (anchor) {
      case 'top-right': x = sw - w - 20; y = 20; break;
      case 'bottom-left': x = 20; y = sh - h - 20; break;
      case 'bottom-right': x = sw - w - 20; y = sh - h - 20; break;
      default: x = 20; y = 20;
    }
    mainWindow.setPosition(x, y);
    config.position = { x, y };
  }
  saveConfig();
});

ipcMain.on('toggle-compact', () => toggleCompact());
ipcMain.on('set-theme', (_e, theme) => setTheme(theme));
ipcMain.on('quit-app', () => { app.isQuitting = true; app.quit(); });

// ── App Lifecycle ──────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();
  startDataCollection();

  // Global shortcut: Ctrl+Shift+S to toggle visibility
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    toggleVisibility();
  });

  // Global shortcut: Ctrl+Shift+L to toggle position lock
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    togglePositionLock();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  saveConfig();
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  if (dataInterval) clearInterval(dataInterval);
});
