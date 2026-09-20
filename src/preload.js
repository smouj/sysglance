'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — preload / contextBridge
//
// The renderer runs with contextIsolation: true, nodeIntegration: false and
// sandbox: true, so this file is the *only* way it can reach the main process.
// Everything below is an explicit, named wrapper around exactly one channel —
// there is no generic "invoke anything" / "send anything" escape hatch, and
// `on()` only subscribes to the events listed in EVENTS.
//
// Argument validation happens in the main process (src/main.js,
// src/config.js); this side only shapes the calls.
// ═══════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  'system-data',            // metrics payload
  'app-version',            // { version, electron }
  'config-changed',
  'visibility-changed',
  'position-lock-changed',
  'theme-changed',
  'layout-changed',
  'compact-mode-changed',
  'display-topology-changed',
  'toggle-settings',
  'toggle-palette',
  'shell-config-changed'
];

const SHELL_CHANNELS = {
  getState: 'shell:taskbar:getState',
  undo: 'shell:undo',
  setPosition: 'shell:taskbar:setPosition',
  setAutoHide: 'shell:taskbar:setAutoHide',
  restartExplorer: 'shell:taskbar:restartExplorer',
  setDark: 'shell:theme:setDark',
  accentFromWallpaper: 'shell:accent:fromWallpaper',
  accentAuto: 'shell:accent:auto',
  accentSetHex: 'shell:accent:setHex',
  applyWallpaper: 'shell:wallpaper:apply',
  pickWallpaper: 'shell:wallpaper:pick',
  wallpaperPreview: 'shell:wallpaper:preview',
  listWallpapers: 'shell:wallpaper:list',
  wallpaperGalleryPreview: 'shell:wallpaper:galleryPreview',
  openWallpaperFolder: 'shell:wallpaper:openFolder',
  readFolderCustomization: 'shell:folder:readCustomization',
  writeFolderCustomization: 'shell:folder:writeCustomization',
  listSpecialFolders: 'shell:folder:listSpecial',
  restoreFolderDefault: 'shell:folder:restoreDefault',
  getStartMenuState: 'shell:startMenu:getState',
  setStartMenuToggle: 'shell:startMenu:setToggle',
  openWindowsPersonalization: 'shell:startMenu:openPersonalization',
  widgetInfo: 'shell:widget:info',
  openWidget: 'shell:widget:open'
};

// One narrow wrapper per shell channel, generated from the table above so the
// exposed surface stays in sync with the channel list.
const shellApi = {};
for (const name of Object.keys(SHELL_CHANNELS)) {
  shellApi[name] = (arg) => ipcRenderer.invoke(SHELL_CHANNELS[name], arg);
}

contextBridge.exposeInMainWorld('sysglance', {
  // app / environment
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // metrics
  getSystemData: () => ipcRenderer.invoke('get-system-data'),

  // settings (validated again in the main process)
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  setOpacity: (value) => ipcRenderer.invoke('set-opacity', value),

  // commands
  togglePositionLock: () => ipcRenderer.send('toggle-position-lock'),
  toggleVisibility: () => ipcRenderer.send('toggle-visibility'),
  toggleCompact: () => ipcRenderer.send('toggle-compact'),
  quit: () => ipcRenderer.send('quit-app'),

  // filesystem
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  copyText: (value) => ipcRenderer.invoke('copy-text', value),
  control: {
    open: (action) => ipcRenderer.invoke('control:open', action)
  },

  // local profiles: one named wrapper per operation, no generic IPC bridge
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    save: (name) => ipcRenderer.invoke('profiles:save', name),
    apply: (name) => ipcRenderer.invoke('profiles:apply', name),
    applyShell: (name) => ipcRenderer.invoke('profiles:applyShell', name),
    undo: () => ipcRenderer.invoke('profiles:undo'),
    remove: (name) => ipcRenderer.invoke('profiles:delete', name),
    rename: (oldName, newName) => ipcRenderer.invoke('profiles:rename', oldName, newName),
    duplicate: (sourceName, targetName) => ipcRenderer.invoke('profiles:duplicate', sourceName, targetName),
    export: (name) => ipcRenderer.invoke('profiles:export', name),
    import: () => ipcRenderer.invoke('profiles:import')
  },

  processes: {
    openLocation: (pid) => ipcRenderer.invoke('process:openLocation', pid),
    endTask: (pid) => ipcRenderer.invoke('process:endTask', pid)
  },

  diagnostics: {
    inspect: (force) => ipcRenderer.invoke('diagnostics:inspect', force === true),
    copy: () => ipcRenderer.invoke('diagnostics:copy'),
    export: () => ipcRenderer.invoke('diagnostics:export'),
    openLogs: () => ipcRenderer.invoke('diagnostics:openLogs')
  },

  // Windows shell configuration (position/theme/accent/wallpaper only —
  // the resident vibrancy effect belongs to OpenClaw Widget)
  shell: shellApi,

  // events: subscribe returns an unsubscribe function
  on: (channel, listener) => {
    if (!EVENTS.includes(channel)) throw new Error('channel not exposed: ' + channel);
    if (typeof listener !== 'function') throw new Error('listener must be a function');
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
});
