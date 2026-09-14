<p align="center">
  <img src="assets/logo.svg" width="128" height="128" alt="SysGlance Logo">
</p>

<h1 align="center">SysGlance</h1>

<p align="center">
  <strong>Futuristic semi-transparent desktop overlay for real-time PC monitoring</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-33-61dafb?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/status-stable-brightgreen?style=flat-square" alt="Status">
</p>

<p align="center">
  <img src="docs/screenshot.png" width="420" alt="SysGlance Screenshot">
</p>

---

## ✨ What is SysGlance?

SysGlance is a **semi-transparent desktop overlay** that floats on top of your windows — like a sci-fi HUD — showing real-time CPU, memory, GPU, network, disk, temperature, and process data. No taskbar icon, no window chrome, no server required. Pure monitoring, always visible, never in the way.

Built for power users, developers, and anyone who wants system vitals at a glance.

## 🖥️ Features

- **Frameless overlay** — floats on top of all windows, no title bar, no taskbar entry
- **Semi-transparent glass** — `backdrop-filter` blur with 78% opacity, see your desktop through it
- **Always on top** — stays visible while you work, game, or stream
- **Real-time stats** — CPU (per-core gauge), memory, GPU, network speed, disk usage, temperatures, top processes
- **Circular CPU gauge** — animated SVG ring with color-coded load levels (cyan → orange → red)
- **Per-core visualization** — individual load bars for every core
- **GPU monitoring** — model name, VRAM usage, utilization
- **Network speed** — live download/upload rates
- **Disk usage** — color-coded bars per volume
- **Temperature monitoring** — CPU package and core temps with color thresholds
- **System tray** — show/hide from tray, position selector, quit
- **Keyboard shortcut** — `Ctrl+Shift+S` to toggle visibility
- **Adjustable position** — top-right, top-left, bottom-right, bottom-left from tray menu
- **Opacity control** — hover to reveal slider, adjust transparency
- **Compact mode** — toggle from tray for a smaller footprint
- **Dark & Light themes** — switch from tray menu
- **🪟 Shell section** — replaces **TranslucentTB** + **Rainmeter**: taskbar dock position and auto-hide (StuckRects3), taskbar blur/acrylic through our own native helper, desktop wallpaper, accent colour sampled from the wallpaper, and Windows dark mode
- **Zero server** — 100% local, no web server, no API calls, no telemetry
- **Low footprint** — ~1.5s refresh interval, minimal CPU/RAM impact
- **No extra dependencies** — the Shell features use in-box Windows APIs (`reg.exe`) plus one ~7 KB native helper compiled by the .NET Framework compiler that ships with Windows

## 📦 Install

### Pre-built (Recommended)

Download the latest release from [Releases](https://github.com/sysglance/sysglance/releases):

- **Windows**: `SysGlance-Setup-x.x.x.exe` (NSIS installer)
- **Linux**: `SysGlance-x.x.x.AppImage`

### From Source

The project folder is always spelled **`sysglance`** (`~/Projects/sysglance` in
a WSL checkout, `%USERPROFILE%\Projects\sysglance` on native Windows). Windows
reaches a WSL checkout through `\\wsl.localhost\<distro>\home\<user>\Projects\sysglance`.

```bash
git clone https://github.com/sysglance/sysglance.git
cd sysglance
npm install
npm start
```

```powershell
# native Windows (PowerShell)
cd "$env:USERPROFILE\Projects\sysglance"
npm install
npm start
```

> The **Shell** features (taskbar position/auto-hide, blur, wallpaper, accent)
> are Windows-only and need the native helper built once — see
> [Build the native helper](#-build-the-native-helper). On Linux/macOS the Shell
> panel hides itself and SysGlance runs as a plain monitoring overlay.

## 🛠️ Build

```bash
# Build for current platform
npm run build

# Build for Windows
npm run build:win

# Build for Linux
npm run build:linux
```

### Build the native helper

The taskbar vibrancy helper is compiled by the .NET Framework compiler that ships
with Windows — no SDK, no Visual Studio, no npm native module:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-native.ps1
# -> src\native\trayblur\SysGlanceTrayBlur.exe
```

From a WSL checkout the same script runs through Windows interop (the full path
is used because `powershell.exe` is not always on `PATH` inside WSL):

```bash
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
```

The Shell panel reports `helper not built` while this step is missing. The helper
also exposes `--wallpaper=<path>` and `--refresh-theme`, which is how SysGlance
repaints the desktop and applies theme changes without any extra dependency.

Built binaries go to `dist/`.

## ⌨️ Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` | Toggle overlay visibility |
| `Ctrl+Shift+L` | Lock/unlock position (overlay ↔ draggable) |
| Tray click | Show / Hide overlay |
| Tray menu | Position, Compact, Theme, Quit |

## 🎨 Customization

SysGlance uses CSS custom properties. Edit `src/styles.css` `:root` section:

```css
:root {
  --accent: #00e5ff;                      /* Primary accent color */
  --glass-bg: rgba(12, 14, 20, 0.78);     /* Background + opacity */
  --card-radius: 14px;                     /* Card corner radius */
  --glass-blur: 24px;                      /* Blur intensity */
}
```

- Change `--glass-bg` alpha to adjust transparency (0.0 = invisible, 1.0 = opaque)
- Change `--accent` for a different color theme (e.g. `#ff6b35` for orange, `#a855f7` for purple)
- Light theme available via tray menu (or set `data-theme="light"` on `<body>`)

## 📁 Project Structure

```
sysglance/
├── src/
│   ├── main.js           # Electron main process (overlay, tray, IPC)
│   ├── preload.js        # Secure IPC bridge (contextIsolation-ready, not wired yet)
│   ├── renderer.js       # UI logic & data binding
│   ├── index.html        # Overlay layout
│   ├── styles.css        # Glass/HUD theme
│   ├── shell/
│   │   ├── taskbar.js    # Taskbar geometry, theme, accent, wallpaper (reg.exe, no deps)
│   │   ├── ipc.js        # shell:* IPC channels
│   │   ├── panel.js      # Shell panel (renderer, self-contained)
│   │   └── panel.css     # Shell panel styling
│   └── native/
│       ├── trayBlurController.js        # Node wrapper around the helper
│       └── trayblur/SysGlanceTrayBlur.cs # Native helper source (+ built .exe)
├── assets/
│   ├── logo.svg          # Vector logo (white, transparent bg)
│   ├── icon.png          # App icon (256×256)
│   └── tray-icon.png     # System tray icon (16×16)
├── docs/
│   ├── SHELL.md          # Shell section: registry map, IPC reference, native build, verification
│   └── TODO-IPC-SECURITY.md  # contextIsolation / nodeIntegration migration debt
├── scripts/
│   ├── build-native.ps1             # Builds the native helper with csc.exe
│   ├── verify-shell.js              # Shell verification harness (no deps)
│   └── verify-accent-pixels.ps1     # Windows-side accent-sampler cross-check
├── package.json
├── .gitignore
├── LICENSE               # MIT
└── README.md
```

## 🪟 Shell (TranslucentTB + Rainmeter replacement)

The **Shell** panel in the overlay and the **🪟 Shell** tray submenu control the
taskbar and the desktop look:

| Control | What it does |
|---|---|
| Taskbar position | Left / Top / Right / Bottom — `StuckRects3` byte 12 |
| Auto-hide | `StuckRects3` byte 8, bit 0 |
| Taskbar blur | Apply once / resident watcher / stop (our native helper) |
| Dark mode | `AppsUseLightTheme` + `SystemUsesLightTheme` |
| Accent | Colour sampled from the wallpaper → DWM `AccentColor` / `ColorizationColor` / `AutoColorization` / `ColorPrevalence` |
| Wallpaper | `Wallpaper` + `WallpaperStyle` + `TileWallpaper`, then `SystemParametersInfo` via the helper |

Taskbar position and auto-hide only take effect after `explorer.exe` restarts;
SysGlance says so in its log and offers **`⟳ Restart Explorer`** in the Shell
tray submenu and inline in the panel.

Full details — the verified registry byte map, the `reg.exe` access method, the
`shell:*` IPC reference, the native build step and the verification commands —
are in **[docs/SHELL.md](docs/SHELL.md)**.

The IPC security model (`nodeIntegration: true`, `contextIsolation: false`) is
**unchanged**; the migration plan is tracked in
[docs/TODO-IPC-SECURITY.md](docs/TODO-IPC-SECURITY.md).

## 🧰 Tech Stack

| Technology | Purpose |
|---|---|
| **Electron 33** | Desktop runtime |
| **systeminformation** | Hardware & OS data |
| **Vanilla JS** | Zero framework overhead |
| **CSS backdrop-filter** | Native glass effect |
| **SVG** | Animated gauge rings |

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-thing`)
3. Commit your changes (`git commit -m 'feat: add amazing thing'`)
4. Push to the branch (`git push origin feature/amazing-thing`)
5. Open a Pull Request

## 📄 License

[MIT](LICENSE) — use it, modify it, share it.

---

<p align="center">
  <sub>Built with ♥ for people who want their system stats always visible.</sub>
</p>
