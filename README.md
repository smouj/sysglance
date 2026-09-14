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
- **Zero server** — 100% local, no web server, no API calls, no telemetry
- **Low footprint** — ~1.5s refresh interval, minimal CPU/RAM impact

## 📦 Install

### Pre-built (Recommended)

Download the latest release from [Releases](https://github.com/sysglance/sysglance/releases):

- **Windows**: `SysGlance-Setup-x.x.x.exe` (NSIS installer)
- **Linux**: `SysGlance-x.x.x.AppImage`

### From Source

```bash
git clone https://github.com/sysglance/sysglance.git
cd sysglance
npm install
npm start
```

## 🛠️ Build

```bash
# Build for current platform
npm run build

# Build for Windows
npm run build:win

# Build for Linux
npm run build:linux
```

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
│   ├── preload.js        # Secure IPC bridge (contextIsolation-ready)
│   ├── renderer.js       # UI logic & data binding
│   ├── index.html        # Overlay layout
│   └── styles.css        # Glass/HUD theme
├── assets/
│   ├── logo.svg          # Vector logo (white, transparent bg)
│   ├── icon.png          # App icon (256×256)
│   └── tray-icon.png     # System tray icon (16×16)
├── docs/
│   └── screenshot.png    # App screenshot for README
├── package.json
├── .gitignore
├── LICENSE               # MIT
└── README.md
```

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
