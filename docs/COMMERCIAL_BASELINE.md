# SysGlance commercial baseline

Audit date: 2026-09-20  
Audited commit: current audited tip of `main` (see `git log -1`)
Host used for verification: Windows 10 Pro 10.0.19045, x64, Intel Core i7-6700 (8 logical CPUs), 16 GiB RAM.

This is an evidence-based baseline. A feature is listed as implemented only when it is present in executable code and was exercised by a check or by the real Electron self-test.

## Commands run

| Command | Result |
|---|---|
| `npm ci` | PASS; 285 packages installed. `npm audit` and production-only audit report 0 vulnerabilities. The initial Electron 33/electron-builder 25 audit found 14 findings; the toolchain was upgraded and retested. |
| `npm run verify` | PASS; 37 syntax, 36 config, 28 shell, 43 extended shell, 17 history/health/alert, 10 metric, 7 diagnostics, 7 journal, 4 transaction, 5 profile-shell, 14 profile, 8 process, 10 display, 6 install, 18 desktop-action, 4 logging, 4 privacy and unique IPC checks. |
| `npm run self-test` | PASS on Electron 44.4.3 after fixing duplicate Shell IPC registration. Real Electron window, preload bridge, fast/slow collection, product layer and hostile path refusal exercised. |
| `npm run bench` | PASS as a measurement; see `PERFORMANCE_BASELINE.md`. |
| `npm run verify:portable` | PASS 3/3; portable executable and native helper were found in `dist-portable`. |
| `npm run build:win` / `npm run build:win:portable` | PASS on electron-builder 26.15.3; NSIS and portable artifacts plus native helper were produced. NSIS: 111,919,208 bytes, SHA-256 `EB68780CA7814D1A324FEC3430B557293CD7E34260C1D729A7008EB2D3705BCC`; portable: 100,602,529 bytes, SHA-256 `2D8C60B5FE7B4430996FBAB0CD140C6B064F848C59612419BA0AE86A43CFFF8D`. |

## Verified functionality

- Electron 44 overlay with tray, single-instance lock, three layouts (Sidebar, Dock, Corner), opacity, theme and compact mode.
- Fast metrics use Node's `os` module; slow metrics use `systeminformation` only for GPU, storage, network, process, battery and temperature data; static identity is cached per session.
- Section-aware slow collection: hidden sections do not issue their corresponding expensive calls.
- Renderer is sandboxed with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP and an explicit preload bridge.
- Config normalization, clamping, prototype-pollution resistance, atomic persistence and collapsible sections.
- Windows shell reads and controlled writes: taskbar position/auto-hide byte math, theme, accent, wallpaper, wallpaper gallery, special folders, Start settings and Explorer restart planning.
- Folder opening is allow-listed to the six offered home folders; wallpaper inputs are validated before decode/registry/native-helper use.
- Wallpaper gallery listing, preview and Explorer launch are constrained to `Pictures\\Wallpaper` descendants, with canonical-path checks for existing junctions/symlinks.
- Rotating local logs and uncaught exception/unhandled rejection logging.
- Bounded session-local history (24-hour ring-buffer ceiling), selectable 1m/5m/30m/1h/6h/24h CPU/RAM sparklines and objective System Status rows.
- Local alert state machine with duration, cooldown and recovery transitions.
- Local desktop profiles with atomic versioned persistence, import/export, configurable hotkeys and a separate confirmed shell-apply transaction.
- Last-profile-apply undo for SysGlance-owned settings, a bounded shell-mutation undo journal, plus a narrow Ctrl+K navigation palette.
- Sanitized diagnostics summary copy/export with private wallpaper paths, serials, MACs and IPs redacted or excluded.
- On-demand hardware inspector covering system/BIOS/baseboard, memory, storage, graphics, adapters and displays.
- Network session totals/peak rates, nullable disk-I/O activity, process filtering (including exclusion of Windows' synthetic System Idle Process) and PID/path clipboard actions.
- Configurable toggle/lock/palette shortcuts with duplicate refusal and reduced-motion/forced-colour CSS fallbacks.
- Allow-listed Windows command-center actions for Settings, network, display, apps, Task Manager, Services, workstation lock, sleep and restart; state-changing power actions require confirmation and no arbitrary URI or command input crosses IPC.
- Multi-monitor placement: validated display selection, work-area-aware geometry, topology metadata and display hot-plug fallback.
- NSIS configuration, per-user install scripts, Linux/macOS targets and a Windows CI job are declared.

## Incomplete or not yet evidenced

- Profiles now support local save/apply/duplicate/rename/delete/import/export, retain configurable hotkeys, and expose a separate confirmed shell-apply transaction with rollback, including bounded exact snapshots for the six known folder icons.
- The inspector, sanitized export, ZIP support bundle, local Open logs action, live adapter details and on-demand folder analysis are implemented; bundle review remains limited to the local redaction gate.
- Disk-I/O/temperature fields remain provider-dependent and may be unavailable; the UI preserves null rather than fabricating values.
- Direct shell changes and profile shell application use the bounded undo journal; folder customization rollback and profile shell rollback restore exact `desktop.ini` bytes.
- Windows 10/11, DPI matrix, sleep/resume, Explorer restart, GPU reset and monitor disconnect/reconnect remain NOT VERIFIED on a hardware test matrix; the runtime now has display topology and hot-plug handling.
- The native C# helper is built by the Windows package workflow and was present in the packaged app at `resources/SysGlanceShellHelper.exe`.
- Code signing uses electron-builder's current local signing path but no publisher certificate is configured; production certificate handling remains NOT IMPLEMENTED.
- The compatibility ledger is explicit in `docs/COMPATIBILITY_MATRIX.md`; remote GitHub Actions green status and clean-machine install/uninstall are still NOT VERIFIED.

## Security observations

- No generic renderer IPC invoke/send surface was found.
- `shell.openPath` is reached only after an allow-list check for home folders; null bytes and path canonicalization should remain regression-tested when Electron is upgraded.
- Registry writes are concentrated in `src/shell/taskbar.js`; direct shell mutations are recorded in a bounded local journal without executable commands. Full transaction coverage and live destructive-action verification remain outstanding.
- Code signing and secure update are documentation/design work only; auto-update is not implemented.

## First commercial milestones

1. Verify the Windows 10/11, DPI, sleep/resume, Explorer restart, GPU reset and monitor hot-plug matrix.
2. Review profile folder-icon behavior after Explorer restart and external icon-file moves.
3. Review support-bundle retention/redaction with external support workflows.
4. Close code-signing and secure-update gaps before release-candidate distribution.
