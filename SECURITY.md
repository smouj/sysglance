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

## Out of scope

- Issues that require an already-compromised machine.
- Cosmetic problems in third-party skins or wallpapers you load yourself.
