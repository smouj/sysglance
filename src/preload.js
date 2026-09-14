// SysGlance — Preload script (bridge for contextIsolation if enabled later)
// Currently using nodeIntegration: true for simplicity, but this file
// provides forward compatibility if we switch to contextIsolation.

const { contextBridge, ipcRenderer } = require('electron');

// If contextIsolation is ever enabled, expose APIs here
// For now, renderer.js uses ipcRenderer directly via nodeIntegration
