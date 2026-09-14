# Changelog

All notable changes to SysGlance are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-09-15

Performance, security and scope-alignment release. No new npm dependencies.

### Changed — refresh pipeline (the headline)

- **CPU, memory, uptime and load now come from Node's own `os` module**, in
  process, with no child processes. The previous implementation called eight
  `systeminformation` functions on every 1500 ms tick; that module shells out
  (`df`, `ps`, `lscpu`, `sensors`, `wmic`, `powershell` depending on the
  platform). Measured with `npm run bench`:
  - fast tier: **0.47 ms** per cycle and **0** child processes (was ~47 ms and
    ~12.5 child processes for the equivalent per-tick work).
  - steady state: **2.9 child processes/s** instead of 8.3, and **11.8 ms/s** of
    compute instead of 31.1 ms/s — 2.9× fewer spawns, 2.6× lighter, measured on
    the same host in the same run (`scripts/bench-metrics.js`).
- **`systeminformation` is now used only for what Node cannot read** — GPU,
  temperatures, disks, network counters, top processes, battery — on a slow
  tier with a configurable 5–10 s cadence (default 7 s). Sections the user has
  hidden are no longer queried at all, so hiding *Top Processes* removes the
  single most expensive call.
- **Static data is cached once per session** (CPU model, core count, OS
  identity) instead of being re-read on a 30 s timer.
- The measured cost of the last cycle is shown in the status bar, so the
  performance claim is visible in the UI rather than asserted in a README.
- On Linux, memory usage is read from `/proc/meminfo` `MemAvailable` (the same
  number the OS reports) with `os.freemem()` as the fallback; on other
  platforms `os.freemem()` is used directly.

### Changed — scope alignment with the desktop suite

- The Shell panel **no longer applies a resident taskbar vibrancy effect**. Per
  `PRODUCT.md` rules 1 and 2, the resident effect is owned by
  [OpenClaw Widget](https://github.com/smouj/openclaw-desktop-widget); two
  processes applying window policy to the same taskbar fight each other.
  SysGlance keeps the configuration it owns (taskbar position, auto-hide, dark
  mode, accent, wallpaper) and the UI now states where the effect lives, with a
  link to the sibling repository.
- Removed the `shell:blur:*` channels, the resident blur watcher, the
  `trayBlurController` module and the `SysGlanceTrayBlur` C# helper including
  its `--watch` mode. The shipped native helper
  (`SysGlanceShellHelper`) now only sets the wallpaper and broadcasts theme
  changes — both one-shot, both exiting immediately.
- A missing native helper now degrades wallpaper application to
  "registry written, repaint on the next logon" instead of failing the panel.

### Security

- **The renderer is sandboxed: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`.** `src/preload.js` exposes a narrow `window.sysglance` API
  through `contextBridge` — one named wrapper per channel, no generic
  `invoke`/`send` escape hatch, and an allow-list for event subscriptions.
  `docs/TODO-IPC-SECURITY.md` is replaced by `docs/IPC-SECURITY.md`, which
  documents the model now in force.
- **Every IPC argument is validated in the main process**: settings go through
  the schema in `src/config.js` (type, range, enum), `open-folder` requires an
  absolute path to an existing directory, and wallpaper paths must be absolute
  and exist.
- The Content-Security-Policy no longer allows inline scripts
  (`script-src 'self'`), and adds `object-src`, `base-uri`, `form-action` and
  `connect-src` restrictions.

### Added

- `src/config.js` — one owner for defaults, validation and atomic persistence
  (temp file + rename). Unknown keys are dropped, out-of-range values are
  clamped, prototype-pollution keys are refused, corrupt files fall back to
  defaults with a logged warning.
- `src/log.js` — console plus a size-capped rotating log file
  (`userData/logs/sysglance.log`), wired to `uncaughtException` and
  `unhandledRejection`.
- `src/metrics.js` — the three-tier collector described above.
- `--self-test` mode (`npm run self-test`): boots the real window, runs one
  fast and one slow cycle, verifies the preload bridge reached the renderer and
  that the version is rendered, then exits non-zero on any error. Used by CI.
- Version is read from `package.json` via `app.getVersion()` and shown in the
  status bar and settings footer, with Electron/Chromium/Node versions on
  hover.
- `scripts/verify-syntax.js`, `scripts/verify-config.js`,
  `scripts/bench-metrics.js`; `npm run verify` runs the syntax, settings and
  shell gates in one command.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml` and
  `docs/IPC-SECURITY.md`.

### Fixed

- The settings panel's *Compact Mode* button sent a `toggle-compact` message
  that the main process never handled; it now toggles and persists.
- Theme and compact-mode changes are broadcast on the dedicated channels the
  renderer already listened to (`theme-changed`, `compact-mode-changed`).
- Windows now shows a real notification-worthy error box on an uncaught main
  process exception instead of dying silently.
- `window-all-closed` no longer risks quitting the tray app on any platform.

### Removed

- `src/native/trayBlurController.js`, `src/native/trayblur/**` (C# + committed
  `.exe`) and the resident vibrancy code path. The native helper binary is no
  longer committed; build it with `scripts/build-native.ps1`.

## [1.1.0] — 2026-09-15

### Added

- Shell section: taskbar position and auto-hide (`StuckRects3`), dark/light
  mode, accent derived from the wallpaper, wallpaper application, and a native
  C# helper for `SystemParametersInfo`.
- `scripts/verify-shell.js` harness and `docs/SHELL.md`.
- Layout modes (sidebar / dock / corner), settings panel, section toggles,
  smart window positioning, tray menus.

## [1.0.0] — 2026-09-15

### Added

- Initial overlay: CPU, memory, GPU, disks, network, filesystem folders,
  processes, battery, tray icon, global shortcuts, NSIS installer config.
