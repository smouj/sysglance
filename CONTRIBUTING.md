# Contributing to SysGlance

SysGlance is deliberately narrow: a compact system monitor, not a desktop-personalization suite. Read [`PRODUCT.md`](PRODUCT.md) before adding a feature.

## Setup

```bash
git clone https://github.com/smouj/sysglance.git
cd sysglance
npm ci
npm start
```

Node.js 20+ is required. `systeminformation` is the only runtime dependency.

## Required gates

Run before every pull request:

```bash
npm run verify
npm run bench -- --iterations=5
```

`npm run verify` covers:

| Gate | Contract |
|---|---|
| `verify:syntax` | Shipped JavaScript parses. |
| `verify:config` | Settings defaults, bounds, migration and rejected keys. |
| `verify:ui` | Required cards/layouts exist, dashboard does not globally scroll, Shell/OpenClaw code does not return, geometry remains explicit and backdrop blur stays out. |

For a real Electron smoke test:

```bash
npm run self-test
```

Linux CI runs it under Xvfb.

## Performance rules

- Fast tier: Node/OS APIs only, default 1500 ms.
- Hardware tier: `systeminformation`, default 7000 ms.
- Static data: once per session.
- Hidden hardware sections should not be queried unnecessarily.
- Avoid rebuilding unchanged DOM regions.
- Do not add continuously animated decoration or backdrop blur.

If you change collection cadence or add a hardware query, include before/after benchmark output in the pull request.

## Product boundary

Do **not** add code that mutates the Windows Shell. This repository must not own:

- taskbar position, auto-hide, transparency or vibrancy;
- Start menu registry values;
- wallpaper changes;
- Explorer restarts;
- folder icon customization;
- generic registry or command execution helpers.

A feature that requires those capabilities is out of scope for SysGlance.

## IPC rules

- Renderer code stays sandboxed.
- New privileged actions must be explicit named methods in `src/preload.js`.
- Never expose a generic `invoke(channel, ...)` bridge.
- Validate every argument again in the main process.
- File/system actions must use an allow-list whenever practical.

## Code conventions

- Vanilla JavaScript and CSS; no framework/build pipeline for the UI.
- Keep dependencies minimal.
- Comments explain architectural reasons, not obvious syntax.
- Conventional commit subjects (`feat:`, `fix:`, `perf:`, `docs:`, `test:`, `chore:`).
- Update `CHANGELOG.md` for user-visible changes.
- Version bumps belong in release commits.

## Packaging

```bash
npm run build:win
npm run build:linux
npm run build:mac
```

GitHub Actions is the canonical installer/package validation environment.

## Bug reports

Include OS/version, SysGlance version, reproduction steps, expected/actual result and the relevant tail of the application log under Electron's `userData/logs` directory.
