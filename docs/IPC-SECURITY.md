# IPC security model

SysGlance renders untrusted UI code in a sandboxed Electron renderer and exposes only a small allow-listed bridge.

## BrowserWindow isolation

`src/main.js` creates the window with:

```js
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,
  backgroundThrottling: true
}
```

The renderer has no Node.js filesystem/process APIs and no direct `ipcRenderer` access.

## Exposed renderer API

`src/preload.js` exposes only:

```text
getAppInfo()
getSystemData()
setConfig(key, value)
setOpacity(value)
openFolder(path)
togglePositionLock()
toggleVisibility()
quit()
on(allowedEvent, listener)
```

There is no generic IPC passthrough and no Windows Shell API.

Allowed events are restricted to metrics, application/config changes, visibility/lock state, theme/layout changes and the settings toggle.

## Validation

- `set-config` accepts only keys in `src/config.js` `WRITABLE_KEYS` and validates their type/range/enum.
- `set-opacity` passes through the same validated configuration path.
- `open-folder` accepts only a resolved path contained in the current home-folder list produced by SysGlance itself.
- Shell, registry, Explorer and arbitrary command-execution channels do not exist.

Configuration is normalized again before persistence.

## Content Security Policy

`src/index.html` uses a CSP equivalent to:

```text
default-src 'self';
style-src 'self' 'unsafe-inline';
script-src 'self';
img-src 'self' data:;
connect-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
```

Inline styles remain enabled because metric widths are rendered as style values. Inline scripts and network connections are disabled.

## Verification

`npm run verify` checks syntax, configuration migration and the UI/IPC contract. In particular, `scripts/verify-ui.js` rejects regressions that reintroduce Shell IPC or a Shell UI.

CI additionally launches the real Electron application under Xvfb as a smoke test.
