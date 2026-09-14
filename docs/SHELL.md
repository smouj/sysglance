# SysGlance — Shell section

The **Shell** panel configures the Windows shell SysGlance sits on. It is the
configuration half of the split described in [`PRODUCT.md`](../PRODUCT.md):

| Concern | Owner |
|---|---|
| Taskbar position, auto-hide, dark mode, accent, wallpaper | **SysGlance** (this document) |
| Resident taskbar **vibrancy** effect (blur / acrylic) | **OpenClaw Widget** — https://github.com/smouj/openclaw-desktop-widget |

> **SysGlance holds no resident behaviour.** It writes a setting, remembers what
> it wrote, and stops. There is no watcher, no `--watch` mode and no
> `shell:blur:*` channel. Two processes applying window policy to the same
> taskbar fight each other and both burn CPU, so the effect belongs to exactly
> one app — the always-resident one. The panel states this in the UI and links
> to the sibling repository.

Everything is implemented with APIs that already ship with Windows.
**No npm dependency was added** — `package.json` still lists
`systeminformation` as its only runtime dependency.

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
memory, and the complete blob is written back — so taskbar size, monitor binding
and the other sticky-rect flags survive.

> **Explorer restart required.** `explorer.exe` caches this structure in memory.
> After changing position or auto-hide, the tray menu item
> **`⟳ Restart Explorer`** (and the banner the Shell panel shows) runs
> `taskkill /f /im explorer.exe` followed by starting `explorer.exe`.
> SysGlance logs a warning at that point, and it never does this on its own.

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

Node cannot call Win32 without a native npm module, so this call is exposed by
the helper we compile ourselves (§4) as `--wallpaper=<path>`. The same helper
exposes `--refresh-theme`, which broadcasts
`WM_SETTINGCHANGE("ImmersiveColorSet")` and
`WM_DWMCOLORIZATIONCOLORCHANGED` so already-running apps repaint after a
theme/accent write.

Both modes are **one-shot and exit immediately**. If the helper is not built,
`applyWallpaper()` still writes the registry and reports
`registryApplied: true, systemParametersInfo: false` — the wallpaper then appears
at the next logon instead of instantly. That degradation is deliberate: a
missing optional binary should not break the panel.

### Accent sampled from the wallpaper

`shell:accent:fromWallpaper` (and the "Auto accent" button) decode the wallpaper
with Electron's built-in `nativeImage`, downscale it to 64 px, and average the
pixels that look like a usable accent colour:

* skipped: transparent (`A < 128`), near-black (`value < 0.12`),
  greys (`saturation < 0.15`), blown-out white (`value ≥ 0.95` and
  `saturation < 0.2`)
* `value = max(R,G,B)/255` is used instead of luma on purpose — a saturated blue
  has a luma of 0.07 and would otherwise be discarded as "black"
* if nothing survives the filter, the plain average of all opaque pixels is used
* returns `{ r, g, b, hex }`

Verification against an independent implementation: §6.

## 3. Files

| File | Role |
|---|---|
| `src/shell/taskbar.js` | Registry access, taskbar geometry, theme, accent, wallpaper, explorer restart |
| `src/shell/ipc.js` | The whole `shell:*` IPC surface + `config.shell` persistence |
| `src/shell/panel.js` | Renderer-side panel: builds its own DOM, wires the channels |
| `src/shell/panel.css` | Panel styling (same palette/vars as the rest of the app) |
| `src/native/shellHelper.js` | Controller for the native helper (spawn, timeout, no throw) |
| `src/native/shell/SysGlanceShellHelper.cs` | The helper itself: wallpaper + theme broadcast |
| `scripts/build-native.ps1` | Compiles the helper with the in-box `csc.exe` |
| `scripts/verify-shell.js` | Verification harness (no dependencies) |
| `scripts/verify-accent-pixels.ps1` | Windows-side reference implementation for the accent sampler |

`src/index.html` gains exactly two lines:

```html
<link rel="stylesheet" href="shell/panel.css">
<script src="shell/panel.js"></script>
```

Everything else the panel needs it creates itself, which keeps the panel out of
the way of future refactors of the shared UI files. The panel runs sandboxed and
talks to the main process only through `window.sysglance.shell.*`
(see [`IPC-SECURITY.md`](IPC-SECURITY.md)).

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

The helper is compiled by the in-box .NET Framework compiler — no SDK, no Visual
Studio, no npm native module:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-native.ps1
# -> src\native\shell\SysGlanceShellHelper.exe
```

From a WSL checkout the same script can be run through Windows interop:

```bash
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
```

The binary is **git-ignored** (see `.gitignore`); build it once per checkout.
Modes:

```
SysGlanceShellHelper.exe --wallpaper=<absolute path>   set the desktop wallpaper (SystemParametersInfo)
SysGlanceShellHelper.exe --refresh-theme               broadcast theme/accent change
SysGlanceShellHelper.exe --help                        usage
```

The controller (`src/native/shellHelper.js`) resolves the binary at
`src/native/shell/SysGlanceShellHelper.exe`, overridable with the
`SYSGLANCE_HELPER` environment variable.

### What was removed, and why

The earlier `SysGlanceTrayBlur` helper had `--once`, `--watch` and `--clear`
modes that applied window composition attributes (`SetWindowCompositionAttribute`)
to `Shell_TrayWnd` and could stay resident re-applying them every 2 s. That is a
resident taskbar effect, which `PRODUCT.md` rule 1 assigns to OpenClaw Widget
alone. The whole path is gone: helper, controller, `shell:blur:*` channels and
panel controls. SysGlance now only writes configuration.

## 5. IPC reference

All channels are handled in `src/shell/ipc.js`. Every **mutating** channel
answers `{ result, state }` — `result` describes what happened, `state` is a
fresh snapshot so the UI can re-render in a single round trip. The renderer
reaches them through `window.sysglance.shell.*`.

| Channel | Argument | Returns |
|---|---|---|
| `shell:taskbar:getState` | — | full state (taskbar, theme, accent, wallpaper, widget, config) |
| `shell:taskbar:setPosition` | `'left'\|'top'\|'right'\|'bottom'` or `0..3` | `{ ok, changed, position, restartRequired }` |
| `shell:taskbar:setAutoHide` | `boolean` | `{ ok, changed, autoHide, restartRequired }` |
| `shell:taskbar:restartExplorer` | — | `{ ok, killed, relaunched }` |
| `shell:theme:setDark` | `boolean` | `{ ok, dark, refresh }` |
| `shell:accent:fromWallpaper` | optional path | `{ ok, r, g, b, hex, kept, sampled }` |
| `shell:accent:auto` | — | writes AccentColor/ColorizationColor/AutoColorization/ColorPrevalence |
| `shell:wallpaper:apply` | absolute path | `{ ok, registryApplied, systemParametersInfo, helperOutput }` |
| `shell:wallpaper:pick` | — | `{ ok, path, base }` — native file dialog |
| `shell:widget:info` | — | `{ name, repo, ownsVibrancy }` |
| `shell:widget:open` | — | opens the OpenClaw Widget repository |

`shell:wallpaper:pick`, `shell:taskbar:restartExplorer` and the two
`shell:widget:*` channels are additions beyond the originally specified list;
the first two make the panel usable (choosing a file, applying a pending taskbar
change) and the last two exist so the vibrancy ownership statement is actionable
rather than a dead end.

The renderer additionally receives `shell-config-changed` whenever anything is
persisted, so tray-menu actions and the panel stay in sync without polling.

## 6. Verification

Literal commands and their outcome (from a WSL checkout, Windows 10 Pro 22H2
build 19045):

```bash
# syntax of every touched JS file
node scripts/verify-syntax.js                    # 14 files checked, 0 failed

# module loads outside Electron (no electron require at load time)
node -e "require('./src/shell/taskbar.js')"      # OK

# full harness: live state, byte math, reversible registry write, accent math
node scripts/verify-shell.js                     # 26 passed, 0 failed
```

Held-out cross-check: under WSL, Electron runs headlessly against Xvfb, so
`nativeImage` can decode the real wallpaper directly. The independent
`System.Drawing` reference is still useful for the accent algorithm:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-accent-pixels.ps1 \
  -Path 'C:\Users\<you>\Pictures\Wallpaper\your.png' -OutFile 'C:\...\temp.bin'
node scripts/verify-shell.js --pixels <temp.bin> 64 36
```

`System.Drawing` rebuilds the same BGRA buffer and computes the reference
average with the same filter rules; the Node implementation must return the
identical number:

```
reference=#37345d r=55 g=52 b=93 kept=2303 sampled=2303     # PowerShell / System.Drawing
{"ok":true,"r":55,"g":52,"b":93,"hex":"#37345d", ...}       # node src/shell/taskbar.js
```

## 7. Configuration

State is persisted by `src/config.js` in `userData/config.json` under a `shell`
key. Unknown keys are dropped and invalid values fall back to the defaults, with
a warning in the log:

```json
{
  "configVersion": 2,
  "shell": {
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

`wallpaperPath` is refused unless it is absolute; `taskbarPosition` must be
`0..3` or `null`; an accent must be `{ r, g, b, hex }` with each channel in
`0..255` and a `#rrggbb` hex.

## 8. Known limitations

* **Position / auto-hide need an explorer restart** to be picked up (Windows
  behaviour, not a SysGlance bug). SysGlance warns and offers the action; it
  never restarts explorer on its own.
* **Dark mode** writes both theme DWORDs and broadcasts the change, but already
  running applications may still need a re-login to repaint fully.
* **`--refresh-theme` takes a few seconds** (one `SendMessageTimeout` per
  top-level window, ~300 ms each). It is therefore fired asynchronously and
  never blocks an IPC reply.
* **Wallpaper needs the native helper** for an immediate repaint; without it the
  registry is written and the change lands at the next logon.
* The Shell panel hides itself where there is no Windows registry (Linux/macOS).
  The rest of the app works there.
* Theme/accent/wallpaper changes are **not** transactional across a crash; each
  write is a single `reg.exe` call.
