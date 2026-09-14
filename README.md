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
  <img src="docs/screenshot.png" width="340" alt="SysGlance Sidebar Mode">
</p>

---

## ✨ What is SysGlance?

SysGlance is a **semi-transparent desktop overlay** that floats on top of your windows — like a sci-fi HUD — showing real-time CPU, memory, GPU, network, disk, temperature, processes, and **filesystem folders** you can click to open. No window, no server, no taskbar entry. Pure monitoring, always visible, never in the way.

Runs in the **system tray** as a background process. Close the window → it hides to tray. `Ctrl+Shift+S` toggles it. Fully configurable via the built-in **⚙️ Settings Panel**.

## 🖥️ Features

### Monitoring
- **CPU** — Per-core load bars, temperature, speed, model name
- **Memory** — Usage bar, swap, formatted GB readout
- **GPU** — Model, utilization, VRAM, temperature
- **Filesystem** — Desktop, Documents, Downloads, Pictures, Videos, Music — click to open in file manager
- **Disks** — Multi-volume usage with color-coded bars
- **Network** — Live download/upload speed per interface
- **Processes** — Top 8 by CPU with color-coded percentages
- **Battery** — Percentage, charging status (laptops only)

### Layout Modes
| Mode | Description |
|---|---|
| **Sidebar** | Default vertical panel — full detail, scrollable |
| **Dock** | Horizontal bar — compact, wide, sits at bottom |
| **Corner** | Mini widget — ultra-compact, essential stats only |

### Settings Panel
Click the **⚙️** button or right-click → Settings Panel for:
- **Layout** — Switch between Sidebar, Dock, Corner
- **Position** — Snap to any of 4 screen corners
- **Theme** — Dark / Light
- **Opacity** — 30% to 100% transparency
- **Refresh Rate** — 0.5s to 5s update interval
- **Section Toggles** — Show/hide individual sections (CPU, Memory, GPU, etc.)
- **Lock/Unlock** — Overlay mode (click-through) vs drag mode

### Desktop Integration
- **System tray icon** — Always running, never in your way
- **Hide to tray** — Window close = hide, not quit
- **Single instance** — No duplicate windows
- **Auto-position** — Snaps to chosen corner, adapts to screen size
- **`Ctrl+Shift+S`** — Toggle visibility globally
- **`Ctrl+Shift+L`** — Toggle overlay/drag mode
- **Right-click menu** — Position, theme, layout, settings

## 📦 Install

### From Source
```bash
git clone https://github.com/smouj/sysglance.git
cd sysglance
npm install
npm start
```

### Build Installer (Windows)
```bash
npm run build:win
```
Produces `dist/SysGlance-Setup-x.x.x.exe` — NSIS installer with Start Menu shortcut and desktop icon.

### Build (Linux)
```bash
npm run build:linux
```

## ⌨️ Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` | Show / Hide overlay |
| `Ctrl+Shift+L` | Lock / Unlock position |
| `⚙️` button | Open Settings Panel |
| Right-click | Context menu (layout, theme, position) |
| Tray double-click | Show / Hide |
| Folder click | Opens folder in file manager |

## 🎨 Customization

All visual customization happens in the **Settings Panel** (⚙️ button). Advanced users can edit `src/styles.css`:

```css
:root {
  --accent: #00e5ff;                      /* Primary accent color */
  --glass-blur: 22px;                      /* Blur intensity */
  --bg-primary: rgba(10, 10, 20, 0.82);   /* Background + opacity */
  --radius: 10px;                          /* Card corner radius */
}
```

## 📁 Project Structure

```
sysglance/
├── src/
│   ├── main.js           # Electron main — overlay, tray, IPC, settings, layouts
│   ├── preload.js        # Secure IPC bridge
│   ├── renderer.js       # UI logic, settings panel, layout switching
│   ├── index.html        # Overlay layout + settings panel
│   └── styles.css        # Glass/HUD theme, 3 layout modes
├── assets/
│   ├── logo.svg          # Vector logo (white, transparent bg)
│   ├── icon.png          # App icon (256×256)
│   └── tray-icon.png      # System tray icon (16×16)
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
| **SVG** | Animated progress indicators |
| **rAF batching** | Smooth 60fps UI updates |

## 🤝 Contributing

1. Fork the repo
2. `git checkout -b feature/amazing-thing`
3. `git commit -m 'feat: add amazing thing'`
4. `git push origin feature/amazing-thing`
5. Open a Pull Request

## 📄 License

[MIT](LICENSE) — use it, modify it, share it.

---

<p align="center">
  <sub>Built with ♥ for people who want their system stats always visible.</sub>
</p>
