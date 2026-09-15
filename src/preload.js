'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'system-data',
  'app-version',
  'config-changed',
  'visibility-changed',
  'position-lock-changed',
  'theme-changed',
  'layout-changed',
  'toggle-settings'
]);

contextBridge.exposeInMainWorld('sysglance', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getSystemData: () => ipcRenderer.invoke('get-system-data'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  setOpacity: (value) => ipcRenderer.invoke('set-opacity', value),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  togglePositionLock: () => ipcRenderer.send('toggle-position-lock'),
  toggleVisibility: () => ipcRenderer.send('toggle-visibility'),
  quit: () => ipcRenderer.send('quit-app'),
  on: (channel, listener) => {
    if (!EVENTS.has(channel)) throw new Error('channel not exposed: ' + channel);
    if (typeof listener !== 'function') throw new Error('listener must be a function');
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
});
