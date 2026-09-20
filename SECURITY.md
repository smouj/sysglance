# Security Policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private reporting: **Security → Report a vulnerability** in this repository.
You will get an answer within 72 hours, and credit in the release notes if you want it.

## Scope

SysGlance is a local desktop application: no server, no telemetry, no network services.
The parts that matter most for security are:

- the Electron renderer isolation model (`contextIsolation`, `sandbox`, `preload` allow-list),
- the native helper used for wallpaper/theme calls,
- anything that reads or writes Windows registry values.

Reports about those areas are especially welcome.

## Audit status

The renderer/main boundary is covered by `docs/IPC-SECURITY.md` and the
repository audit is recorded in `docs/COMMERCIAL_BASELINE.md`. The current
Electron 44.4.3/electron-builder 26.15.3 is now the pinned development
toolchain; `npm audit` is clean after the upgrade and the Electron self-test
passes. Code signing and secure auto-update are not implemented.

## Out of scope

- Issues that require an already-compromised machine.
- Cosmetic problems in third-party skins or wallpapers you load yourself.
