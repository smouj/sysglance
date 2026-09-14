# SysGlance — Shell section

The **Shell** panel turns SysGlance into a replacement for two tools it would
otherwise sit next to:

| Replaced tool | What SysGlance now does |
|---|---|
| **TranslucentTB** | Taskbar vibrancy (blur / acrylic / tint) through our own native helper, plus dock-edge position and auto-hide |
| **Rainmeter** | Desktop wallpaper, accent colour derived from the wallpaper, dark/light mode switching |

Everything is implemented with Windows APIs that already exist on the machine.
**No new npm dependency was added** (see `package.json` — dependencies are still
`systeminformation` only).

---

## 1. Taskbar geometry

Taskbar geometry lives in a single `REG_BINARY` value:

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3
  Settings   REG_BINARY   (48 bytes on Windows 10 Pro 22H2 / build 19045)
```

Verified byte map (Windows 10 Pro 22H2, build 19045):

| Offset | Meaning |
|---|---|
| `byte[12]` | dock edge — `0` left, `1` top, `2` right, `3` bottom |
| `byte[8]` bit `0` (`0x01`) | taskbar auto-hide |

Only those bytes are touched: the blob is read in full, one byte is modified in
memory, and the complete blob is written back — so taskbar size, monitor
binding and the other sticky-rect flags survive.

> **Explorer restart required.** `explorer.exe` caches this structure in memory.
> After changing position or auto-hide, the tray menu item
> **`⟳ Restart Explorer`** (and the banner that appears in the Shell panel)
> runs `taskkill /f /im explorer.exe` followed by starting `explorer.exe`.
> SysGlance logs a warning at that point; nothing is restarted behind your back.

Sample live read (`node src/shell/taskbar.js taskbar`):

```json
{
  "ok": true,
  "key": "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects3",
  "size": 48,
  "hex": "30000000FEFFFFFF0280000003000000BA0000001E00000000000000E202000050050000000300006000000001000000",
  "positionIndex": 3,
  "position": "bottom",
  "autoHide": false,
  "autoHideByte": 2
}
```

## 2. Theme, accent and wallpaper

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize
  AppsUseLightTheme     REG_DWORD   0 = dark, 1 = light
  SystemUsesLightTheme  REG_DWORD   0 = dark, 1 = light
  ColorPrevalence       REG_DWORD   1 = accent shown on taskbar/start

HKCU\Software\Microsoft\Windows\DWM
  AccentColor           REG_DWORD   0xAABBGGRR  (ABGR — note the order!)
  ColorizationColor     REG_DWORD   0xAARRGGBB  (ARGB — the other order)
  AutoColorization      REG_DWORD   1 = Windows derives the accent from the wallpaper

HKCU\Control Panel\Desktop
  Wallpaper             REG_SZ      full path
  WallpaperStyle        REG_SZ      "10" = fill
  TileWallpaper         REG_SZ      "0"
```

Writing the registry is **not enough** for the wallpaper: the desktop only
repaints after

```
SystemParametersInfo(SPI_SETDESKWALLPAPER /* 20 */, 0, path, SPIF_UPDATEINIFILE|SPIF_SENDCHANGE /* 3 */)
```

Node cannot call Win32 without an npm native module, so this call is exposed by
the **helper we already compile ourselves** (§4) as `--wallpaper=<path>`.
The same helper exposes `--refresh-theme`, which broadcasts
`WM_SETTINGCHANGE("ImmersiveColorSet")` and
`WM_DWMCOLORIZATIONCOLORCHANGED` so already-running apps repaint after a
theme/accent write.

### Accent sampled from the wallpaper

`shell:accent:fromWallpaper` (and the "Auto accent" button) decode the wallpaper
with Electron's built-in `nativeImage`, downscale it to 64 px, and average the
pixels that look like a usable accent colour:

* skipped: transparent (`A < 128`), near-black (`value < 0.12`),
  greys (`saturation < 0.15`), blown-out white (`value ≥ 0.95` and
  `saturation < 0.2`)
* `value = max(R,G,B)/255` is used instead of luma on purpose — a saturated
  blue has a luma of 0.07 and would otherwise be discarded as "black"
* if nothing survives the filter, the plain average of all opaque pixels is used
* returns `{ r, g, b, hex }`

Verification against an independent implementation: §6.

## 3. Files added

| File | Role |
|---|---|
| `src/shell/taskbar.js` | Registry access, taskbar geometry, theme, accent, wallpaper, explorer restart |
| `src/shell/ipc.js` | The whole `shell:*` IPC surface + `config.shell` persistence |
| `src/shell/panel.js` | Renderer-side panel: builds its own DOM, wires the channels |
| `src/shell/panel.css` | Panel styling (same palette/vars as the rest of the app) |
| `scripts/verify-shell.js` | Verification harness (no dependencies) |
| `scripts/verify-accent-pixels.ps1` | Windows-side reference implementation for the accent sampler |

`src/index.html` gains exactly two lines:

```html
<link rel="stylesheet" href="shell/panel.css">
<script src="shell/panel.js"></script>
```

Everything else the panel needs it creates itself, which keeps the panel out of
the way of future refactors of the shared UI files.

### Registry access method (documented choice)

`reg.exe`, invoked through `child_process.execFile` with an **argument array**
(never a shell string):

```
read : reg query KEY /v NAME        -> "    Settings    REG_BINARY    3000...00"
write: reg add   KEY /v NAME /t REG_BINARY /d <hex> /f
```

* `regedit` / `ffi-napi` / `koffi` are npm dependencies — not allowed here.
* `reg.exe` ships with Windows 10, exits `0`/`1` and prints parseable output.
* Binary blobs are parsed and edited with `Buffer`, so unrelated bytes are
  written back verbatim.
* Under WSL the same Windows binary is reachable through the interop mount
  (`/mnt/c/Windows/System32/reg.exe`), which is what makes the read-only checks
  in §6 reproducible from a WSL shell. Override with `SYSGLANCE_REG_EXE`.

## 4. Native helper build

The taskbar vibrancy helper is compiled by the in-box .NET Framework compiler —
no SDK, no Visual Studio, no npm native module:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-native.ps1
# -> src\native\trayblur\SysGlanceTrayBlur.exe
```

From a WSL checkout the same script can be run through Windows interop:

```bash
/path/to/powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
```

Helper modes:

```
SysGlanceTrayBlur.exe --once [--tint=AARRGGBB] [--acrylic]   apply and exit
SysGlanceTrayBlur.exe --watch [--tint=AARRGGBB] [--acrylic]  resident, re-applies every 2s
SysGlanceTrayBlur.exe --clear                                restore Windows default
SysGlanceTrayBlur.exe --wallpaper=<path>                     set desktop wallpaper (SystemParametersInfo)
SysGlanceTrayBlur.exe --refresh-theme                        broadcast theme/accent change
```

`--wallpaper` and `--refresh-theme` are the modes added for the Shell section;
the first three behave exactly as before.

## 5. IPC reference

All channels are handled in `src/shell/ipc.js`. Every **mutating** channel
answers `{ result, state }` — `result` describes what happened, `state` is a
fresh snapshot so the UI can re-render in a single round trip.

| Channel | Argument | Returns |
|---|---|---|
| `shell:taskbar:getState` | — | full state (taskbar, theme, accent, wallpaper, blur, config) |
| `shell:taskbar:setPosition` | `'left'\|'top'\|'right'\|'bottom'` or `0..3` | `{ ok, changed, position, restartRequired }` |
| `shell:taskbar:setAutoHide` | `boolean` | `{ ok, changed, autoHide, restartRequired }` |
| `shell:taskbar:restartExplorer` | — | `{ ok, killed, relaunched }` |
| `shell:theme:setDark` | `boolean` | `{ ok, dark, refresh }` |
| `shell:accent:fromWallpaper` | optional path | `{ ok, r, g, b, hex, kept, sampled }` |
| `shell:accent:auto` | — | writes AccentColor/ColorizationColor/AutoColorization/ColorPrevalence |
| `shell:wallpaper:apply` | path | `{ ok, registryApplied, systemParametersInfo, helperOutput }` |
| `shell:wallpaper:pick` | — | `{ ok, path, base }` — native file dialog |
| `shell:blur:apply` | `{ acrylic?, tint? }` | helper stdout (`applied=N`) |
| `shell:blur:start` | `{ acrylic?, tint? }` | `{ ok, pid }` — resident watcher |
| `shell:blur:stop` | — | `{ ok }` |
| `shell:blur:status` | — | `{ running, pid, helperExists, helperPath }` |

`shell:wallpaper:pick` and `shell:taskbar:restartExplorer` are additions beyond
the originally specified channel list; both exist to make the panel usable
(choosing a file, applying a pending taskbar change).

The renderer additionally receives `shell-config-changed` whenever anything is
persisted, so tray-menu actions and the panel stay in sync without polling.

## 6. Verification

Literal commands and their outcome (run from the WSL checkout, Windows 10 Pro
22H2 build 19045):

```bash
# syntax of every touched JS file
for f in src/main.js src/shell/taskbar.js src/shell/ipc.js src/shell/panel.js scripts/verify-shell.js; do node --check "$f"; done   # all OK

# module loads outside Electron (no electron require at load time)
node -e "require('./src/shell/taskbar.js')"      # OK

# full harness: live state, byte math, reversible registry write, accent math
node scripts/verify-shell.js                     # 26 passed, 0 failed

# independent acent-sampler cross-check on the REAL wallpaper pixels
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-accent-pixels.ps1 \
  -Path 'C:\Users\<you>\Pictures\Wallpaper\your.png' -OutFile 'C:\...\temp.bin'
node scripts/verify-shell.js --pixels <temp.bin> 64 36
```

The cross-check is the interesting one: `System.Drawing` rebuilds the same BGRA
buffer and computes the reference average with the same filter rules, and the
Node implementation must return the identical number:

```
reference=#37345d r=55 g=52 b=93 kept=2303 sampled=2303     # PowerShell / System.Drawing
{"ok":true,"r":55,"g":52,"b":93,"hex":"#37345d", ...}       # node src/shell/taskbar.js
```

That value also matches the DWM accent Windows itself derived from the same
wallpaper (`AccentColor=0xff5c3335` → `#35335c`), which is the expected result
for an accent sampler that agrees with Windows.

## 7. Configuration

State is persisted in the existing `userData/config.json` under a `shell` key
(merged, not replaced, when an older config is loaded):

```json
{
  "shell": {
    "taskbarBlur": { "enabled": false, "resident": false, "acrylic": false, "tint": null },
    "taskbarPosition": null,
    "autoHide": null,
    "darkMode": null,
    "accentAuto": false,
    "accent": null,
    "wallpaperPath": null,
    "restartRequired": false
  }
}
```

## 8. Known limitations

* **Position / auto-hide need an explorer restart** to be picked up (Windows
  behaviour, not a SysGlance bug). Explorer restarting also reloads the taskbar
  blur, which is exactly what the resident watcher (`--watch`) is for.
* **Dark mode** writes both theme DWORDs and broadcasts the change, but already
  running applications may still need a re-login to repaint fully.
* **`--refresh-theme` takes a few seconds** (one `SendMessageTimeout` per
  top-level window; ~6 s on a busy desktop). It is therefore fired
  asynchronously and never blocks an IPC reply.
* The **resident blur watcher is stopped when SysGlance quits**, so no orphan
  process is left behind. Blur stays applied until the next explorer restart.
* The Shell panel hides itself where there is no Windows registry (Linux/macOS).
* Theme/accent/wallpaper changes are **not** transactional across a crash; each
  write is a single `reg.exe` call.
