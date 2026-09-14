# TODO — IPC security model

**Status: deliberately unchanged in the "Shell" task. This file records the debt
so it is not lost.**

## Current model

`src/main.js` creates the overlay window with:

```js
webPreferences: {
  nodeIntegration: true,
  contextIsolation: false,
  backgroundThrottling: false
}
```

and `src/renderer.js` / `src/shell/panel.js` use
`require('electron').ipcRenderer` directly. `src/preload.js` exists but is only a
forward-compatibility stub — it is not wired up.

## Why it matters

With `nodeIntegration: true` and `contextIsolation: false`, **any JavaScript that
executes in the renderer runs with full Node privileges** (filesystem, process
spawning, registry). The renderer loads local files only, and the page has a CSP
(`default-src 'self'`), so the current exposure is limited — but the Shell
section raises the stakes, because a compromised renderer could now also reach
`reg.exe`, `taskkill` and `explorer.exe` through the shipped IPC surface.

## Migration sketch (not done here)

1. Set `contextIsolation: true` and `nodeIntegration: false`.
2. Expose a narrow, explicit API from `src/preload.js` with `contextBridge`:

   ```js
   contextBridge.exposeInMainWorld('sysglance', {
     getSystemData: () => ipcRenderer.invoke('get-system-data'),
     shell: {
       getState: () => ipcRenderer.invoke('shell:taskbar:getState'),
       setPosition: (p) => ipcRenderer.invoke('shell:taskbar:setPosition', p)
     }
     // ...one wrapper per channel
   });
   ```

3. Replace every `require('electron')` in `renderer.js` and `shell/panel.js`
   with `window.sysglance.*`.
4. Validate IPC arguments in the main process (the Shell handlers currently
   trust `pos`, `enabled` and the wallpaper path; `setPosition` and
   `setAutoHide` do validate, the wallpaper path should be constrained to an
   absolute path that exists).
5. Keep the CSP and consider dropping `'unsafe-inline'`.

The Shell channels were designed with this in mind: every mutation goes through
a named channel with a narrow argument, instead of exposing a generic
"run this registry command" bridge.
