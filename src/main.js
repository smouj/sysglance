'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const log = require('./log');
const configModule = require('./config');
const metrics = require('./metrics');

const APP_VERSION = app.getVersion();
const SELF_TEST = process.argv.includes('--self-test');

let mainWindow = null;
let tray = null;
let configPath = null;
let config = configModule.defaults();
let positionLocked = false;
let isVisible = false;
let isQuitting = false;
let fastTimer = null;
let slowTimer = null;
let slowRunning = false;
let staticData = null;
let lastFast = null;
let lastSlow = null;
let fastMs = null;
let slowMs = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  const result = configModule.load(configPath);
  config = result.config;
  for (const warning of result.warnings || []) log.warn('config: ' + warning);
}

function saveConfig() {
  if (!configPath) return;
  try { config = configModule.save(configPath, config); }
  catch (err) { log.exception('saveConfig', err); }
}

function getLayoutBounds(layout) {
  const work = screen.getPrimaryDisplay().workArea;
  const maxSidebarH = Math.max(600, Math.min(720, work.height - 24));
  if (layout === 'dock') {
    return { w: Math.max(720, Math.min(1180, work.width - 32)), h: 168, minW: 680, minH: 150, maxW: work.width, maxH: 190 };
  }
  if (layout === 'corner') {
    return { w: 304, h: 246, minW: 280, minH: 226, maxW: 340, maxH: 280 };
  }
  return { w: 392, h: maxSidebarH, minW: 360, minH: 600, maxW: 460, maxH: Math.max(600, work.height) };
}

function positionForAnchor(anchor, w, h) {
  const work = screen.getPrimaryDisplay().workArea;
  const margin = 12;
  const left = work.x + margin;
  const top = work.y + margin;
  const right = work.x + work.width - w - margin;
  const bottom = work.y + work.height - h - margin;
  switch (anchor) {
    case 'top-left': return { x: left, y: top };
    case 'bottom-left': return { x: left, y: bottom };
    case 'bottom-right': return { x: right, y: bottom };
    default: return { x: right, y: top };
  }
}

function applyWindowGeometry() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = getLayoutBounds(config.layout);
  const p = positionForAnchor(config.anchor, b.w, b.h);
  mainWindow.setMinimumSize(b.minW, b.minH);
  mainWindow.setMaximumSize(b.maxW, b.maxH);
  mainWindow.setBounds({ x: p.x, y: p.y, width: b.w, height: b.h }, true);
}

function setLocked(locked) {
  positionLocked = !!locked;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(positionLocked, { forward: true });
    mainWindow.webContents.send('position-lock-changed', positionLocked);
  }
  rebuildTray();
}

function showWindow(show) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (show) {
    mainWindow.showInactive();
    isVisible = true;
  } else {
    mainWindow.hide();
    isVisible = false;
  }
  if (mainWindow.webContents) mainWindow.webContents.send('visibility-changed', isVisible);
  rebuildTray();
}

function composePayload() {
  const fast = lastFast || {};
  const slow = lastSlow || {};
  const stat = staticData || {};
  const memory = { ...(fast.memory || {}) };
  if (slow.memory) {
    memory.swapTotal = slow.memory.swapTotal || memory.swapTotal || 0;
    memory.swapUsed = slow.memory.swapUsed || memory.swapUsed || 0;
  }

  return {
    layout: config.layout,
    config,
    cpu: fast.cpu ? {
      load: fast.cpu.load,
      perCore: fast.cpu.perCore || [],
      model: stat.cpuModel || 'CPU',
      cores: stat.cpuCores || fast.cpu.cores || 0,
      speed: fast.cpu.speedMhz || stat.cpuSpeedMhz || null,
      temp: slow.temperature ? slow.temperature.main : null
    } : null,
    memory,
    gpu: slow.gpu || null,
    disks: slow.disks || [],
    network: slow.network || null,
    processes: slow.processes || [],
    battery: slow.battery || null,
    filesystem: slow.filesystem || null,
    os: {
      ...(stat.os || {}),
      uptime: fast.os ? fast.os.uptime : 0
    },
    metrics: {
      fastMs,
      slowMs,
      refreshInterval: config.refreshInterval,
      slowInterval: config.slowInterval,
      slowCalls: slow.calls || []
    }
  };
}

function broadcastData() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  mainWindow.webContents.send('system-data', composePayload());
}

async function collectFast() {
  const started = process.hrtime.bigint();
  try { lastFast = await metrics.collectFast(); }
  catch (err) { log.exception('collectFast', err); }
  finally { fastMs = Number(process.hrtime.bigint() - started) / 1e6; }
  broadcastData();
}

async function collectSlow() {
  if (slowRunning) return;
  slowRunning = true;
  const started = process.hrtime.bigint();
  try { lastSlow = await metrics.collectSlow({ sections: config.showSections }); }
  catch (err) { log.exception('collectSlow', err); }
  finally {
    slowMs = Number(process.hrtime.bigint() - started) / 1e6;
    slowRunning = false;
  }
  broadcastData();
}

function restartMetricTimers() {
  clearInterval(fastTimer);
  clearInterval(slowTimer);
  fastTimer = setInterval(collectFast, config.refreshInterval);
  slowTimer = setInterval(collectSlow, config.slowInterval);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: isVisible ? 'Hide SysGlance' : 'Show SysGlance', click: () => showWindow(!isVisible) },
    { label: positionLocked ? 'Unlock interaction' : 'Lock interaction', click: () => setLocked(!positionLocked) },
    { type: 'separator' },
    {
      label: 'Layout', submenu: configModule.LAYOUTS.map((layout) => ({
        label: layout === 'corner' ? 'Mini' : layout[0].toUpperCase() + layout.slice(1),
        type: 'radio', checked: config.layout === layout,
        click: () => applyConfigPatch('layout', layout)
      }))
    },
    {
      label: 'Theme', submenu: configModule.THEMES.map((theme) => ({
        label: theme.toUpperCase(), type: 'radio', checked: config.theme === theme,
        click: () => applyConfigPatch('theme', theme)
      }))
    },
    { label: 'Settings', click: () => {
      if (!isVisible) showWindow(true);
      if (positionLocked) setLocked(false);
      mainWindow.webContents.send('toggle-settings');
    } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
}

function rebuildTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const candidates = [path.join(__dirname, '..', 'assets', 'tray.png'), path.join(__dirname, '..', 'assets', 'icon.png')];
  let icon = nativeImage.createEmpty();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) { icon = nativeImage.createFromPath(candidate); break; }
  }
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('SysGlance');
  tray.on('click', () => showWindow(!isVisible));
  rebuildTray();
}

function applyConfigPatch(key, value) {
  const result = configModule.validatePatch(key, value);
  if (!result.ok) return { ok: false, reason: result.reason };
  const changed = config[key] !== result.value;
  config[key] = result.value;
  saveConfig();

  if (key === 'opacity' && mainWindow) mainWindow.setOpacity(config.opacity);
  if (key === 'layout' || key === 'anchor') applyWindowGeometry();
  if (key === 'refreshInterval' || key === 'slowInterval' || key === 'showSections') restartMetricTimers();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config-changed', config);
    if (key === 'theme') mainWindow.webContents.send('theme-changed', config.theme);
    if (key === 'layout') mainWindow.webContents.send('layout-changed', config.layout);
  }
  rebuildTray();
  if (changed && key === 'showSections') collectSlow();
  return { ok: true, value: result.value };
}

function registerIpc() {
  ipcMain.handle('get-app-info', () => ({
    name: 'SysGlance', version: APP_VERSION,
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    platform: process.platform
  }));
  ipcMain.handle('get-system-data', () => composePayload());
  ipcMain.handle('set-config', (_event, key, value) => applyConfigPatch(key, value));
  ipcMain.handle('set-opacity', (_event, value) => applyConfigPatch('opacity', value));
  ipcMain.handle('open-folder', async (_event, folderPath) => {
    const folders = (((lastSlow || {}).filesystem || {}).folders || []).map((f) => path.resolve(f.path));
    const resolved = typeof folderPath === 'string' ? path.resolve(folderPath) : '';
    if (!folders.includes(resolved)) return { ok: false, reason: 'path not exposed by SysGlance' };
    const error = await shell.openPath(resolved);
    return error ? { ok: false, reason: error } : { ok: true };
  });
  ipcMain.on('toggle-position-lock', () => setLocked(!positionLocked));
  ipcMain.on('toggle-visibility', () => showWindow(!isVisible));
  ipcMain.on('quit-app', () => { isQuitting = true; app.quit(); });
}

function createWindow() {
  const b = getLayoutBounds(config.layout);
  const p = positionForAnchor(config.anchor, b.w, b.h);
  mainWindow = new BrowserWindow({
    width: b.w, height: b.h,
    minWidth: b.minW, minHeight: b.minH,
    maxWidth: b.maxW, maxHeight: b.maxH,
    x: p.x, y: p.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    title: 'SysGlance ' + APP_VERSION,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: true
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setOpacity(config.opacity);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!SELF_TEST) showWindow(true);
    mainWindow.webContents.send('config-changed', config);
    mainWindow.webContents.send('position-lock-changed', positionLocked);
    mainWindow.webContents.send('app-version', { version: APP_VERSION });
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); showWindow(false); }
  });
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    config.lastX = x; config.lastY = y; saveConfig();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => log.error('renderer process gone: ' + JSON.stringify(details)));
  mainWindow.webContents.on('preload-error', (_event, preloadPath, err) => log.error('preload error ' + preloadPath + ': ' + err.message));
}

async function startMetrics() {
  try { staticData = await metrics.getStatic(); }
  catch (err) { log.exception('getStatic', err); }
  await Promise.all([collectFast(), collectSlow()]);
  restartMetricTimers();
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+S', () => showWindow(!isVisible));
  globalShortcut.register('CommandOrControl+Shift+L', () => setLocked(!positionLocked));
}

app.on('second-instance', () => showWindow(true));
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(async () => {
  log.init(app.getPath('userData'));
  loadConfig();
  registerIpc();
  createWindow();
  createTray();
  registerShortcuts();
  await startMetrics();
  if (SELF_TEST) {
    setTimeout(() => { isQuitting = true; app.quit(); }, 2200);
  }
}).catch((err) => {
  try { log.exception('startup', err); } catch (_) { console.error(err); }
  app.quit();
});
