# IPC security model

**Status: implemented.** This file replaces the earlier
`docs/TODO-IPC-SECURITY.md`, which recorded the debt while the renderer still
ran with `nodeIntegration: true`.

## What the renderer can and cannot do

The overlay window is created with:

```js
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,
  backgroundThrottling: false
}
```

The renderer has **no** `require`, no `process`, no filesystem, no
`child_process`, and no `ipcRenderer`. The only thing it sees is
`window.sysglance`, injected by `src/preload.js` through `contextBridge`.

## The exposed surface

`src/preload.js` is the whole contract. It is an explicit allow-list — there is
deliberately **no generic `invoke(channel, ...)` / `send(channel, ...)`
passthrough**, because that would reintroduce the whole IPC namespace the moment
someone adds a channel in the main process.

```js
window.sysglance = {
  getAppInfo, getSystemData,
  setConfig, setOpacity,
  togglePositionLock, toggleVisibility, toggleCompact, quit,
  openFolder,
  shell: {
    getState, setPosition, setAutoHide, restartExplorer, setDark,
    accentFromWallpaper, accentAuto, applyWallpaper, pickWallpaper,
    widgetInfo, openWidget
  },
  on(channel, listener) -> unsubscribe
}
```

Event subscriptions are restricted to an `EVENTS` allow-list
(`system-data`, `config-changed`, `shell-config-changed`, the theme/layout/
visibility notifications, `app-version`, …). Subscribing to anything else
throws, so a compromised renderer cannot even *listen* to channels it has no
business seeing.

## Argument validation lives in the main process

The preload only shapes calls; it never validates, because a preload wrapper can
be called with anything. Each handler re-checks its input:

| Channel | Validation |
|---|---|
| `set-config` | key must be in `WRITABLE_KEYS`; value checked against the schema in `src/config.js` (type, range, enum). Read-only and unknown keys are refused and logged. |
| `set-opacity` | numeric, clamped to 0.2–1 |
| `open-folder` | must be a string, **absolute**, and an existing **directory** |
| `shell:wallpaper:apply` | must be an absolute path that exists |
| `shell:accent:fromWallpaper` | path must exist before it is decoded |
| `shell:taskbar:setPosition` | `'left'\|'top'\|'right'\|'bottom'` or an integer 0–3 |
| `shell:widget:open` | no argument; opens a hard-coded URL |

Settings also pass through `src/config.js` on the way *to disk*, so a rejected
value cannot be persisted even if a handler were bypassed. `normalize()`
additionally drops unknown top-level keys and refuses `__proto__`,
`constructor` and `prototype`.

## Why this matters more than it did before the Shell section

Before, a compromised renderer could read files and spawn processes with full
Node privileges. After the Shell section landed, the same compromise would also
have reached `reg.exe`, `taskkill` and `explorer.exe` through the IPC surface —
so the renderer stopped being privileged at exactly the point where the blast
radius grew.

The shell channels were designed for this from the start: every mutation is a
named operation with a narrow argument ("set the dock edge to *left*"), never a
generic "run this registry command" bridge.

## Content-Security-Policy

`src/index.html` ships:

```
default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';
img-src 'self' data:; connect-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none';
```

`script-src` has **no** `'unsafe-inline'`: there is not a single inline `<script>`
or inline event handler in the app. `style-src` keeps `'unsafe-inline'` because
the progress bars are sized with inline `style` attributes; that is the one
remaining relaxation and it is not script-executable.

`connect-src 'none'` means the page cannot make network requests at all, so a
successful XSS would still have no exfiltration path short of IPC abuse — which
the allow-list above bounds.

## Verifying it

`npm run self-test` boots the real window and asserts, from inside the renderer:

```js
JSON.stringify({
  api: !!window.sysglance,
  apiKeys: Object.keys(window.sysglance || {}).length,
  versionText: document.getElementById('app-version').textContent,
  shellSection: !!document.getElementById('sec-shell')
})
```

If the preload bridge is missing, the window is misconfigured or a renderer
error occurred, the self-test exits non-zero. CI runs it under Xvfb on every
push.

## Residual notes

* `sandbox: true` means the preload itself may only use the Electron APIs
  available to sandboxed preloads (`contextBridge`, `ipcRenderer`). Keep it that
  way: importing app modules into the preload would undo the isolation.
* The renderer may still be looked at by a user with a debugger attached to the
  app; that is not a threat this model tries to defend against, and it cannot be
  defended against on the user's own machine.
* `shell:wallpaper:pick` opens a native dialog *from the main process*, so a
  renderer cannot fake a file-chooser result — it only receives the chosen path.
