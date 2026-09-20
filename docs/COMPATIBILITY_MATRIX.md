# Windows compatibility matrix

This is an evidence ledger, not a claim that every row is supported. A row is
`VERIFIED` only when the behavior was exercised on the named environment.

| Area | Environment / action | Status | Evidence or next action |
|---|---|---|---|
| OS | Windows 10 Pro 10.0.19045 | VERIFIED | `npm run self-test`, shell harness and real Electron window on 20 Sep 2026. |
| OS | Windows 11 x64 | NOT VERIFIED | Run the same suite on a clean Windows 11 runner/desktop. |
| DPI | 100%, 125%, 150%, 175%, 200% | NOT VERIFIED | Runtime exposes `scaleFactor`; capture visual/frame-pacing evidence at each scale. |
| Displays | One monitor, primary work area | VERIFIED | Current host topology and selected-display placement exercised. |
| Displays | Two or three monitors | NOT VERIFIED | Exercise placement on each monitor and topology changes on physical hardware. |
| Displays | Disconnect/reconnect | NOT VERIFIED | Code falls back to primary on `display-removed`; physical hot-plug remains pending. |
| Power | Lock/unlock | PARTIAL | Lock action is allow-listed; no physical lock/unlock cycle was performed. |
| Power | Sleep/resume | NOT VERIFIED | Sleep command is confirmed and allow-listed; exercise wake/resume and timer recovery. |
| Shell | Explorer restart | PARTIAL | Dry-run command and explicit UI path pass; no destructive restart performed in this audit. |
| Graphics | GPU driver reset | NOT VERIFIED | Requires a real GPU test matrix. |
| Network | Adapter/address change | NOT VERIFIED | On-demand identity and session reset logic are implemented; physical reconnect pending. |
| Packaging | Windows unpacked + NSIS artifact | VERIFIED | `dist-verify`, installer hash in `PERFORMANCE_BASELINE.md`, helper and uninstaller paths checked. |
| Packaging | Install/uninstall on clean machine | NOT VERIFIED | Existing per-user SysGlance install was detected and deliberately not overwritten. |
| CI | GitHub Actions Linux/Windows jobs | NOT VERIFIED HERE | Workflow has full verify, package and uninstaller gates; remote run must be observed green. |

## Interpretation

`PARTIAL` means the safe code path and a non-destructive harness exist, but the
real desktop transition was intentionally not triggered. `NOT VERIFIED` is a
release-blocking test gap for a Windows product, not an assertion that the
feature fails.
