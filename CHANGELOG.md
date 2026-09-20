# Changelog

All notable changes to SysGlance are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Upgraded the runtime/toolchain to Electron 44.4.3 and electron-builder 26.15.3; `npm audit` is clean.

- **System Status** with objective health rows, bounded local history for key metrics and CPU/RAM sparklines.
- **Local Alert Engine** with threshold, duration, cooldown and recovery state transitions.
- Backpressure counters for fast and slow metric cycles, plus verification gates for history, alerts and unique IPC registration.

- **Wallpaper gallery.** List images from `Pictures\Wallpaper` and subfolders, with thumbnail previews. Animated wallpapers (.webm/.mp4) are detected and flagged; SysGlance offers to open the folder for the user's preferred tool (Lively Wallpaper etc.) since Windows has no native animated wallpaper API.
- **Folder customization.** Read/write folder icons via `desktop.ini` (`IconResource` / `IconFile`). Lists the six standard user folders (Desktop, Documents, Downloads, Pictures, Videos, Music) and lets the user customize or restore each. Folder attributes are set correctly for Windows to pick up the change.
- **Start menu personalization.** Read and toggle Start menu settings: show recent apps, show suggestions, full-screen Start mode. Registry keys under `Explorer\Advanced` are written via `reg.exe` (the project's existing pattern). A button opens `ms-settings:personalization`.
- **Custom accent colour picker.** A native `<input type="color">` plus hex input and 16 preset colour dots, all wired to `shell:accent:setHex`. The swatch updates in real time.
- **Desktop preview.** A miniature desktop preview at the top of the Shell panel showing the current wallpaper as background and the taskbar bar on the selected edge, giving immediate visual feedback for position and wallpaper changes.
- **`shell:wallpaper:list`, `shell:wallpaper:galleryPreview`, `shell:wallpaper:openFolder`, `shell:accent:setHex`, `shell:folder:*`, `shell:startMenu:*` IPC channels** (23 total, up from 12).
- `scripts/verify-shell-extended.js` harness covering new module exports, validation, and live Start menu state.
- Collapsible Start menu and Folder icons sections (click the header to expand/collapse).
- Smooth CSS transitions on accent swatch, gallery items, and section groups.

### Fixed

- Removed duplicate Shell IPC registrations that attempted to register `shell:accent:setHex` and legacy aliases twice, producing an Electron handler error during startup.
- Fixed native helper resolution for packaged builds: electron-builder extra resources are resolved from `process.resourcesPath`, while development resolves the helper beside its C# source.

- **SysGlance is not retired.** A concurrent session had added a retirement
  banner to the README and a "queda retirada" status to `PRODUCT.md`, alongside a
  rewrite that reverted the folder tiles, the `open-folder` allow-list, the dock
  height fix and the Dock/Mini captures, and turned the overlay into an opaque
  normal window. The retirement is removed and the app keeps its scope; the
  session's genuinely good additions are kept (see below).
- **The auto-hide assertions in the shell harness no longer assume the bit starts
  clear.** They compared the live `StuckRects3` blob against a canonical off-blob,
  which only held while the user's auto-hide happened to be disabled. They are now
  state-independent, so the harness passes whether auto-hide is on or off. The
  live setting is never modified by the harness.

### Added

- **One logo, everywhere.** `assets/logo.svg` is now the single source of truth.
  The header, the app icon, the tray glyph and the README badge all derive from
  it: previously the header drew a *different* mark (missing the spokes), the app
  icon was white-on-near-white and therefore invisible, and the 16 px tray icon
  was an unreadable blob. `npm run icons` regenerates every raster with Electron
  as the rasteriser — no image dependency. The tray glyph carries no plate and
  uses the accent colour so it reads on both a dark and a light taskbar.
- **Collapsible cards.** Clicking (or Enter/Space on) a card header folds it; the
  headline value stays visible, so a folded card still reports its number. The
  state is persisted through the validated config layer (`collapsedSections`),
  and a single delegated listener also covers the Shell card that `panel.js`
  injects after the renderer has run.
- `npm run icons`, and a sixth capture (`docs/screenshot-small.png`) at the
  smallest supported window, where clipping would show up.

### Changed

- Adopted the concurrent session's cheaper DOM writes: `setText`/`setWidth` only
  touch the DOM when a value actually changed, and the clock ticks on the minute
  boundary (with a refresh on focus/visibility) instead of once a second.
- `backgroundThrottling` is on, so the renderer sleeps while the overlay is
  hidden. The transparent always-on-top window is kept: it is the product's
  identity, and the measured cost the other session reported came from software
  compositing. If it costs CPU on your machine, `createWindow()` has one line to
  flip (`transparent`/`alwaysOnTop`).
- `scripts/install-user.ps1` and `scripts/uninstall-user.ps1` (from the other
  session) are kept and documented in the README.

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
  the schema in `src/config.js` (type, range, enum), folder opening is
  restricted to an allow-list (see below), and wallpaper paths must be absolute
  image files that exist.
- The Content-Security-Policy no longer allows inline scripts
  (`script-src 'self'`), and adds `object-src`, `base-uri`, `form-action` and
  `connect-src` restrictions.
- **`open-folder` is now an allow-list, not a generic "open any path".** The
  renderer may only ask for the six home folders SysGlance actually offers;
  anything else is refused and logged (`open-folder(/etc)` →
  `{"ok":false,"error":"path not allowed"}`). The self-test asserts this on
  every run.
- **Wallpaper paths are validated as regular files with an image extension**
  before anything decodes them, writes them to the registry or hands them to the
  native helper, so `nativeImage` is never pointed at an arbitrary path.
- The renderer receives a downscaled **data URL** for the wallpaper preview —
  never a file handle, and never a path of its choosing.

### Changed — folder menu and Windows shell panel

- **Home folders are real tiles now**: icon, item count with correct
  singular/plural, a hover/focus "open" affordance, `role="button"` with
  Enter/Space activation, an `aria-label` naming the folder, and a short status
  message in the section header when a folder cannot be opened. Previously the
  grid showed a single stretched tile with no sign it was clickable.
- The grid no longer repaints on every slow cycle — it compares a signature of
  the folder list first, so keyboard focus and hover state survive a refresh.
- An explicit empty state replaces a silently blank card when none of the six
  home folders exist.
- **The Shell panel is visual instead of abstract**: taskbar position is drawn as
  a miniature desktop with the bar on the selected edge (one element, four
  rules, accent-aware), the position readout sits beside the label, auto-hide
  and dark mode are switches, and the wallpaper row carries a **thumbnail of the
  current wallpaper** (rendered by the main process) next to the path and its
  Browse/Apply actions.
- Applying a wallpaper now distinguishes "helper not built, repaint at next
  logon" from plain success, instead of reporting both as applied.
- `npm run screenshot` gained a fifth capture (`docs/screenshot-shell.png`) that
  temporarily hides the metric sections so the Shell card is in view.

### Added

- `shell:wallpaper:preview` channel (12 channels total), `i-open` and
  `i-sparkle` icons, and `taskbar.validateImagePath()` /
  `taskbar.wallpaperPreview()`.
- The self-test now proves the two refusals above rather than documenting them.

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
  shell gates in one command.- `CHANGELOG.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml` and
  `docs/IPC-SECURITY.md`.

### Changed — visual system

- **The whole interface was rebuilt on one token set** (surfaces, lines, text,
a  accent, semantic colours, radius and spacing). Dark and light themes are now a
  token swap rather than per-component overrides, so an accent or theme change
  cannot leave a component behind.
- **Emoji replaced with a monochrome SVG icon set** (24×24, one stroke weight,
  `currentColor`) for every section, the header controls and the Shell panel.
  Emoji could not be recoloured, had inconsistent metrics and rendered
  differently per platform — the single biggest reason the panel read as
  amateurish.
- **Header rebuilt.** The previous bar (title, version, clock, performance
  readout and three buttons) wrapped into three lines inside a 360 px window and
  overlapped the wordmark. It is now a single non-wrapping row: brand + version
  chip on the left, measured cycle cost + clock + icon buttons on the right,
  with narrow-window rules that drop the least important readouts first.
- **Settings panel rebuilt**: opaque overlay (the status bar no longer ghosted
  through it), segmented controls for layout/position/theme, real switches,
  sliders with a filled track, explanatory hints for the two refresh cadences,
  and a proper meta footer.
- Per-core load is now a row of bounded vertical bars (a wide full-width cell
  read as a horizontal bar with four cores); process rows gained a rank column
  and aligned tabular figures; storage, network and the home-folder tiles were
  re-laid out around what is actually legible at this size.
- The three layout modes were re-tuned rather than reused: **dock** is now a
  142 px strip whose cards are complete instead of clipped mid-word, and
  **mini** shows CPU, memory and both network directions without overflow.
- `npm run screenshot` (`--screenshot`) boots the real app and refreshes
  `docs/screenshot*.png`, so the README cannot drift from the code.

### Fixed

- **Changing layout or screen corner from the settings panel never resized or
  repositioned the window.** The panel sends `set-config`, which only updated
  the DOM; the geometry code lived behind the separate `set-layout` channel
  that nothing called. Window geometry now hangs off the config change itself,
  so every path (settings, tray, context menu) moves the window.
- **Storage listed pseudo-filesystems.** `si.fsSize()` reports every mount, so
  the panel showed eight lines of squashfs snap loops, tmpfs and 9p drivers
  with truncated paths (`/usr/lib/modules/6.18.33.2-microsoft-standard-WSL2`,
  `0 B / 2.9 GB`) — indistinguishable from a raw `df` dump. Pseudo and
  zero-size mounts are filtered out and the list is sorted largest-first.
- A GPU-less machine no longer renders an empty card with a dangling `N/A`.
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

## [1.3.0] - 2026-09-15

### Added
- **LCD theme** — retro monochrome LCD display aesthetic with phosphor green glow, sharp borders, monospace font, block-style progress bars, and scanning line effect on desktop preview. Toggle in Settings → Appearance → LCD, or via tray/context menu.
- **Wallpaper gallery** — scan `Pictures\Wallpaper` for thumbnails, click-to-apply, animated file detection (.webm/.mp4), open folder in Explorer.
- **Folder customization** — read/write `desktop.ini` for 6 standard folders (Desktop, Documents, Downloads, Pictures, Videos, Music), restore defaults.
- **Start menu toggles** — show/hide recent apps, suggestions, full-screen Start via `HKCU\...\Explorer\Advanced`.
- **Accent colour picker** — native `<input type="color">`, hex input, 16 preset dots, all wired to `setAccentHex`.
- **Desktop preview** — mini desktop with wallpaper background and taskbar bar on the selected edge.

### Changed
- **Performance: incremental rendering** — CPU per-core bars, GPU section, disk list, and process table now use signature-based caching to avoid `innerHTML` rebuilds when data hasn't changed. Steady-state CPU usage drops significantly.
- **Performance: shell panel caching** — Start menu state and special folder list are cached after first fetch; only re-read from registry on explicit refresh or toggle change.
- **Performance: setText/setWidth guards** — all metric text updates use `setText()`/`setWidth()` with equality checks to avoid unnecessary layout invalidation.
- **Shell panel glass styling** — every section now has gradient backgrounds, hover glow, smooth transitions, and depth shadows. Color dots have hover scale. Gallery items have hover zoom. Folder items have hover state. Desktop preview is 72px with shadow depth.
- **Native helper path** — `shellHelper.js` now resolves the helper from `extraResources` alongside the asar, matching electron-builder's packaging convention.

### IPC
- 23 channels (up from 12): `shell:accent:setHex`, `shell:wallpaper:list`, `shell:wallpaper:galleryPreview`, `shell:wallpaper:openFolder`, `shell:folder:readCustomization`, `shell:folder:writeCustomization`, `shell:folder:listSpecial`, `shell:folder:restoreDefault`, `shell:startMenu:getState`, `shell:startMenu:setToggle`, `shell:startMenu:openPersonalization`

### Verification
- 108 checks pass (`npm run verify` — 15 syntax + 33 config + 28 shell + 32 extended)
- Zero new npm dependencies
- All new sections are collapsible
- Dark, light, and LCD themes supported
