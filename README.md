<p align="center">
  <img src="assets/logo.svg" width="128" height="128" alt="SysGlance Logo">
</p>

<h1 align="center">SysGlance</h1>

<p align="center">
  <strong>On-demand desktop control center — real system metrics and Windows shell configuration, in one overlay</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-33-61dafb?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/status-stable-brightgreen?style=flat-square" alt="Status">
  <img src="https://img.shields.io/badge/dependencies-1-blueviolet?style=flat-square" alt="Dependencies">
</p>

<p align="center">
  <img src="docs/screenshot.png" width="340" alt="SysGlance Sidebar Mode">
</p>

---

## ✨ What is SysGlance?

SysGlance is a semi-transparent desktop overlay that floats on top of your
windows — like a sci-fi HUD — showing real-time CPU, memory, GPU, network, disk,
temperature, processes, and **filesystem folders** you can click to open. On
Windows it also **configures the shell** it sits on: taskbar position, auto-hide,
dark mode, accent colour and wallpaper.

It is the *on-demand* half of a two-app desktop suite. Its sibling,
[OpenClaw Widget](https://github.com/smouj/openclaw-desktop-widget), is the
always-resident glance; SysGlance is what you open when you want depth. See
[`PRODUCT.md`](PRODUCT.md) for the split, which is enforced in code — not just in
prose.

Runs in the **system tray** as a background process. Close the window → it hides
to tray. `Ctrl+Shift+S` toggles it. Everything is configurable from the built-in
**⚙️ Settings Panel**.

## 🖥️ Features

### Monitoring
- **CPU** — per-core load, temperature, speed, model
- **Memory** — usage, swap, formatted readout
- **GPU** — model, utilization, VRAM, temperature
- **Disks** — multi-volume usage with colour-coded bars
- **Network** — live download/upload per interface
- **Processes** — top 8 by CPU, colour-coded
- **Battery** — percentage and charging state (laptops only)
- **Filesystem** — Desktop, Documents, Downloads, Pictures, Videos, Music — click to open

### Windows shell configuration
- **Taskbar position** — left / top / right / bottom (`StuckRects3`, one byte edited surgically)
- **Auto-hide** — one bit of one byte, the other sticky-rect flags preserved
- **Dark / light mode**, **accent colour derived from the wallpaper**, **wallpaper application**
- Taskbar *vibrancy* is deliberately **not** here — that resident effect belongs
  to OpenClaw Widget. The panel says so and links to it.

### Layout modes
| Mode | Description |
|---|---|
| **Sidebar** | Default vertical panel — full detail, scrollable |
| **Dock** | Horizontal bar — compact, wide, sits at the bottom |
| **Corner** | Mini widget — ultra-compact, essentials only |

### Settings panel
Layout · position · theme · opacity (30–100%) · **fast refresh (0.5–5 s)** ·
**hardware refresh (5–10 s)** · per-section toggles · lock/drag mode ·
compact mode. Every value is persisted, validated and clamped.

### Performance, measured
The hot path uses **Node's own `os` module in process** — no `wmic`, no
`powershell`, no `df`, no child process at all. `systeminformation` is reserved
for what Node cannot read (GPU, temperatures, disks, network counters,
processes, battery) and runs on a slower, configurable cadence.

Measured with `npm run bench` on the same host, same run:

| | before | after |
|---|---|---|
| cost of one fast cycle | ~47 ms | **0.47 ms** |
| child processes per fast cycle | ~12.5 | **0** |
| steady state, per second of uptime | 31.1 ms / 8.3 spawns | **11.8 ms / 2.9 spawns** |

The status bar shows the measured cost of the last cycle (`⏱ 0.4 ms`), so the
number above is verifiable in the app rather than taken on faith.

## 📦 Install

### Installer (Windows)
Download `SysGlance-Setup-x.y.z.exe` from the releases page and run it. The
installer is a normal NSIS package: per-user by default, no elevation
(`asInvoker`), with Start Menu and desktop shortcuts.

### From source
```bash
git clone https://github.com/smouj/sysglance.git
cd sysglance
npm ci
npm start
```
Node 20 or newer. There are no native npm modules and no build step.

> On Linux, Electron needs a display. For a headless machine or CI:
> `xvfb-run -a npm start`

### Build it yourself
```bash
npm run build:win      # -> dist/SysGlance-Setup-1.2.0.exe   (NSIS)
npm run build:linux    # -> dist/SysGlance-1.2.0.AppImage + .deb
npm run build:mac      # -> dist/*.dmg
```
Building Windows targets from Linux/macOS requires a **32-bit-capable** Wine:
electron-builder runs `rcedit-ia32.exe` to stamp the installer's icon and
version resources, and that is a 32-bit binary. A wine64-only install gets as
far as packaging `dist/win-unpacked/SysGlance.exe` and then fails with
`wine: failed to load ... syswow64\ntdll.dll`. The prerequisite is:

```bash
sudo dpkg --add-architecture i386 && sudo apt-get update
sudo apt-get install wine32:i386
```

CI does not need any of this: `.github/workflows/ci.yml` builds the NSIS
installer on `windows-latest`.

## 🛠️ Development

```bash
npm start              # run the app
npm run self-test      # boot, read metrics, assert the IPC bridge, exit non-zero on error
npm run verify         # syntax + settings validation + shell harness
npm run bench          # before/after refresh-cycle benchmark
```

| Gate | Command | Covers |
|---|---|---|
| Syntax | `npm run verify:syntax` | `node --check` on every JS file in `src/` and `scripts/` |
| Settings | `npm run verify:config` | defaults, clamping, enums, hostile input, atomic persistence |
| Shell | `npm run verify:shell` | live Windows state, byte-precise registry math, accent math |
| End to end | `npm run self-test` | real window, real metrics, `window.sysglance` present, version rendered |

The shell harness is read-only; its only write is a scratch registry key it
deletes in the same run. It never moves the taskbar and never restarts explorer.

## 🔐 Security model

The renderer is untrusted UI code:

```js
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}
```

`src/preload.js` exposes a narrow `window.sysglance` through `contextBridge` —
one named wrapper per channel, no generic `invoke`/`send` escape hatch, and an
allow-list for event subscriptions. Every argument is validated again in the
main process (`src/config.js` for settings, explicit checks for paths).
The CSP allows no inline script and no network access from the page.
Details: [`docs/IPC-SECURITY.md`](docs/IPC-SECURITY.md).

## 📁 Project structure

```
sysglance/
├── src/
│   ├── main.js            # Electron main — window, tray, IPC, metrics loop, self-test
│   ├── preload.js         # contextBridge surface (the only renderer↔main path)
│   ├── renderer.js        # UI logic, settings panel, rAF-batched rendering
│   ├── config.js          # defaults, validation, atomic persistence
│   ├── log.js             # console + rotating file log
│   ├── metrics.js         # fast (node:os) / slow (systeminformation) / static tiers
│   ├── index.html         # overlay layout + settings panel
│   ├── styles.css         # glass/HUD theme, 3 layout modes
│   ├── shell/             # Windows shell configuration
│   │   ├── taskbar.js     #   registry byte math, theme, accent, wallpaper
│   │   ├── ipc.js         #   the shell:* channel surface
│   │   ├── panel.js       #   renderer-side panel (self-contained DOM)
│   │   └── panel.css
│   └── native/
│       ├── shellHelper.js          # controller for the one native binary
│       └── shell/SysGlanceShellHelper.cs   # wallpaper + theme broadcast (one-shot)
├── scripts/
│   ├── verify-syntax.js   # node --check gate
│   ├── verify-config.js   # settings validation harness
│   ├── verify-shell.js    # registry/accent harness (read-only)
│   ├── bench-metrics.js   # before/after refresh-cycle benchmark
│   ├── build-native.ps1   # compiles the C# helper with in-box csc.exe
│   └── verify-accent-pixels.ps1  # independent accent-sampler cross-check
├── assets/                # logo, icons
├── docs/                  # screenshot, SHELL.md, IPC-SECURITY.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── PRODUCT.md             # the split with OpenClaw Widget (tie-breaker)
└── LICENSE                # MIT
```

## ⌨️ Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` | Show / hide overlay |
| `Ctrl+Shift+L` | Lock / unlock position (click-through ↔ draggable) |
| `⚙️` button | Settings panel |
| Right-click | Context menu (layout, position, theme, shell) |
| Tray double-click | Show / hide |
| Folder click | Open in the file manager |

## 🧰 Tech stack

| Technology | Purpose |
|---|---|
| **Electron 33** | Desktop runtime |
| **Node `os` / `/proc`** | Fast metrics tier — in-process, zero spawns |
| **systeminformation** | Hardware tier only (GPU, temps, disks, network, processes, battery) |
| **Vanilla JS + CSS** | Zero framework overhead; `backdrop-filter` for the glass |
| **reg.exe via `execFile`** | Windows shell configuration, argument-array invocation only |
| **In-box `csc.exe`** | The one native helper (wallpaper / theme broadcast) |

## 🤝 Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: run `npm run verify`
before you push, keep the fast tier free of child processes, and do not give
SysGlance a resident taskbar effect.

## 📄 License

[MIT](LICENSE) — use it, modify it, share it.

---

<p align="center">
  <sub>A control center you open, next to a widget that stays. Built for people who want their system stats always visible.</sub>
</p>
