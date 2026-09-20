# SysGlance architecture

SysGlance is an Electron Windows-first control center with a deliberately small native boundary.

```text
BrowserWindow (sandboxed renderer)
        │ explicit preload API
        ▼
main process ── config + logs + lifecycle + tray
        ├── Metric Engine (fast / slow / static)
        ├── HistoryStore (bounded, local, session)
        ├── AlertEngine (threshold / duration / cooldown / recovery)
        ├── Health evaluator (objective status rows)
        ├── Display topology / work-area placement
        ├── Diagnostics inspector / snapshot / profile undo
        ├── Shell journal / transactional profile apply / undo
        └── shell IPC ── taskbar.js ── reg.exe / one-shot C# helper
```

The renderer has no Node access, no filesystem access and no generic IPC primitive. The main process validates paths, settings and shell arguments. Shell writes remain explicit and are never driven by a renderer-supplied command string.

## Lifecycle

1. Load and normalize local config.
2. Create the transparent overlay and preload bridge.
3. Register the unique Shell IPC channel set.
4. Render the shell quickly; static hardware identity and slow providers complete asynchronously.
5. Run non-overlapping fast and slow cycles; compose current metrics, health, history and alerts.
6. Stop timers, flush config and unregister shortcuts on quit.

## Current boundaries

- `src/metrics.js` owns provider access and failure-tolerant metric shape.
- `src/history.js`, `src/health.js` and `src/alerts.js` are dependency-free domain modules.
- `src/shell/taskbar.js` owns Windows registry math and shell operations.
- `src/native/shellHelper.js` resolves the packaged helper from `process.resourcesPath` and the development helper beside its source.

Profiles are stored in a separate versioned local file and apply only the
validated SysGlance configuration. Process actions re-query the PID in the
main process before opening a location or showing the destructive confirmation.
Display selection is validated and resolved against Electron's live display
topology; disconnects fall back to the primary display and reflow the overlay.
The diagnostics export is intentionally a sanitized snapshot and the hardware
inspector is fetched on demand. The support-bundle writer packages the
sanitized snapshot and bounded redacted logs in a dependency-free ZIP. External
support-workflow retention/review and profile folder-icon behavior after
Explorer restart remain future work.
