<div align="center">

# SysGlance

**A compact, always-on-top system glance for Windows, Linux and macOS.**

CPU · memory · GPU · storage · network · processes · folders · battery

MIT · no telemetry · no account · no web runtime

</div>

## What it is

SysGlance is intentionally small: open it, see the state of the machine, move on.

It is **not** a Windows customization suite. It does not modify the taskbar, Start menu, wallpaper, Explorer, registry personalization, folder icons or resident desktop effects. That boundary is part of the product contract in [`PRODUCT.md`](PRODUCT.md).

## Layouts

| Layout | Purpose |
|---|---|
| **Sidebar** | Full glance: CPU, memory, GPU and network first; compact storage, process, folder and battery details below. |
| **Dock** | Wide horizontal strip for persistent monitoring without a tall panel. |
| **Mini** | 2×2 view containing only the four primary live signals. |

All three layouts are designed independently. The main dashboard has **no page-level scrolling**.

## Themes

- **Dark** — default low-contrast system HUD.
- **Light** — high-legibility light surface.
- **LCD** — restrained monochrome terminal/LCD treatment using local system fonts.

No webfonts are downloaded.

## Metrics architecture

SysGlance separates inexpensive live metrics from slower hardware queries:

```text
FAST (default 1.5 s)
  Node os / local OS data
  ├─ CPU load + per-core load
  ├─ memory
  └─ uptime

HARDWARE (default 7 s)
  systeminformation
  ├─ GPU / temperatures
  ├─ storage
  ├─ network
  ├─ top processes
  └─ battery
```

Hidden hardware sections are skipped where possible. The renderer uses guarded DOM updates and list signatures to avoid rebuilding unchanged content.

## Security model

The renderer is sandboxed:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- narrow `contextBridge` API in `src/preload.js`
- CSP with `connect-src 'none'`
- folder opening is allow-listed to paths that SysGlance itself exposed

See [`docs/IPC-SECURITY.md`](docs/IPC-SECURITY.md).

## Install from source

Requirements: Node.js 20+.

```bash
git clone https://github.com/smouj/sysglance.git
cd sysglance
npm ci
npm start
```

### Build

```bash
npm run build:win
npm run build:linux
npm run build:mac
```

Windows builds an NSIS installer. Linux builds AppImage and `.deb` artifacts.

## Controls

- **Gear** — display settings.
- **Lock** — enable/disable click-through interaction.
- **Hide** — send the overlay to the tray.
- `Ctrl+Shift+S` — show/hide.
- `Ctrl+Shift+L` — lock/unlock interaction.

The overlay starts interactive. Locking it makes mouse input pass through to the desktop beneath it.

## Development

```bash
npm run verify
npm run bench -- --iterations=5
npm run self-test
```

`npm run verify` currently gates:

1. JavaScript syntax for shipped runtime and verification files.
2. Configuration schema and migration behavior.
3. UI contract: all three layouts, no global dashboard scroll, no Shell/OpenClaw regression, explicit window geometry and no backdrop blur.

GitHub Actions runs the verification suite, a metrics benchmark, a headless Electron smoke test and platform package builds.

## Project structure

```text
sysglance/
├─ src/
│  ├─ main.js       # Electron lifecycle, tray, geometry, timers and IPC
│  ├─ preload.js    # narrow contextBridge surface
│  ├─ renderer.js   # UI rendering only
│  ├─ config.js     # validated local settings + migration
│  ├─ metrics.js    # static / fast / hardware metric tiers
│  ├─ styles.css    # all layouts and themes
│  └─ index.html    # application UI
├─ scripts/
│  ├─ verify-syntax.js
│  ├─ verify-config.js
│  ├─ verify-ui.js
│  └─ bench-metrics.js
├─ docs/
├─ assets/
└─ PRODUCT.md
```

## Contributing

Before adding a feature, check [`PRODUCT.md`](PRODUCT.md). Features that mutate the Windows Shell or turn SysGlance into a general desktop customizer are intentionally out of scope.

Run `npm run verify` before opening a pull request.

## License

MIT © smouj
