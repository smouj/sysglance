# Contributing to SysGlance

Thanks for helping. This file is short on purpose: it describes how to get a
working checkout, what the gates are, and the two rules that are easy to
violate by accident.

## Getting started

```bash
git clone https://github.com/smouj/sysglance.git
cd sysglance
npm ci            # or npm install
npm start         # runs the Electron app
```

Node 20 or newer. There are **no native npm modules** and no build step for the
JavaScript: `systeminformation` is the only runtime dependency and it ships
prebuilt.

On Linux, Electron needs a display. Headless machines and CI use Xvfb:

```bash
xvfb-run -a npm run self-test
```

## Verify before you push

```bash
npm run verify
```

That runs, in order:

| Gate | What it proves |
|---|---|
| `npm run verify:syntax` | `node --check` on every JS file in `src/` and `scripts/` |
| `npm run verify:config` | settings defaults, clamping, enums, hostile input, atomic persistence |
| `npm run verify:shell` | live Windows state, surgical registry byte math (in memory), accent math |

The shell harness is read-only on Windows. Its only write is a scratch
registry key, `HKCU\Software\SysGlance\VerifyScratch`, which it deletes again in
the same run. **It never moves the taskbar and never restarts explorer.** Keep
it that way.

For the full end-to-end check (real window, real metrics, real preload bridge):

```bash
npm run self-test     # exits non-zero on any error
```

## Performance work

`systeminformation` shells out, so anything added to the hot path is a process
spawn every tick. Before changing the refresh pipeline, measure it:

```bash
npm run bench                                  # before/after in one run
node scripts/bench-metrics.js --iterations=20
```

The rule the current design follows:

* **fast tier** (`config.refreshInterval`, default 1500 ms) — Node core only
  (`os` module, `/proc/meminfo` on Linux). No child process, no native call.
* **slow tier** (`config.slowInterval`, 5–10 s) — `systeminformation`, and only
  for what Node genuinely cannot read (GPU, temperatures, disks, network
  counters, processes, battery).
* **static tier** — read once per session (CPU model, core count, OS identity).

If you add a call to the fast tier, show a benchmark in the pull request.

## Scope: SysGlance configures, the Widget stays resident

`PRODUCT.md` at the repo root is the tie-breaker for anything that touches the
taskbar. In short:

1. Only **OpenClaw Widget** runs a resident taskbar effect.
2. SysGlance **configures** the shell and persists what it wrote.
3. Never ship the same screen in both apps.

Do not add a resident process, watcher or timer that reapplies a taskbar effect.
SysGlance has no `shell:blur:*` channels by design.

## Code conventions

* Vanilla JavaScript, no build step, no framework. `'use strict'` at the top of
  every file.
* New IPC goes through `src/preload.js` as an explicit named wrapper; there is
  no generic `invoke` bridge and there must not be one.
* Validate arguments in the **main** process (`src/config.js` for settings),
  never trust the renderer.
* Comments explain *why*, especially where the alternative was tried and
  rejected. Keep the existing file-header style.
* No new npm dependencies without discussing it first — that constraint is why
  the Windows integration uses `reg.exe` and an in-box C# helper.

## Commits and pull requests

* Conventional-commit subjects: `feat:`, `fix:`, `perf:`, `docs:`, `chore:`.
* Update `CHANGELOG.md` under `## [Unreleased]` for user-visible changes.
* Bump `package.json` `version` only in release commits; the UI reads it from
  there, so a mismatch is visible in the app.
* CI must be green: `.github/workflows/ci.yml` runs the gates above on every
  push and pull request, and builds the Windows installer.

## Windows shell changes

`src/shell/taskbar.js` edits the Windows registry through `reg.exe` with an
argument array (never a shell string). Two rules:

* **Only ever touch the documented bytes.** `StuckRects3` byte `12` for the
  dock edge and bit `0` of byte `8` for auto-hide; everything else is written
  back verbatim. `scripts/verify-shell.js` proves this in memory.
* **Never restart explorer or move the taskbar from a script.** That is a user
  action in the panel or the tray, and it says so before it happens.

The native helper is compiled with the in-box .NET Framework compiler:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-native.ps1
# -> src\native\shell\SysGlanceShellHelper.exe   (git-ignored)
```

## Building the Windows installer from Linux

`npm run build:win` works on Linux only with a 32-bit-capable Wine (electron-builder
stamps the installer through `rcedit-ia32.exe`, a 32-bit binary). A wine64-only
install packages `dist/win-unpacked/SysGlance.exe` and then fails on the resource
step. If you need it locally:

```bash
sudo dpkg --add-architecture i386 && sudo apt-get update
sudo apt-get install wine32:i386
```

Otherwise rely on CI, which builds NSIS on `windows-latest`
(`.github/workflows/ci.yml`) and uploads the installer as an artifact on every
build, attaching it to the release on `v*` tags. Only `npm run build:linux`
(`AppImage` + `deb`) is expected to work on Linux out of the box, and
`sudo dpkg --add-architecture i386` is a system-wide change worth deciding
consciously rather than as a side effect of a build.

## Reporting bugs

Include your OS and version, `package.json` version (or the number shown in the
status bar), what you expected, what happened, and the tail of
`<userData>/logs/sysglance.log`. On Windows that is usually
`%APPDATA%\SysGlance\logs\sysglance.log`; on Linux
`~/.config/SysGlance/logs/sysglance.log`.
