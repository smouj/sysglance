# Security Policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Do not open a public issue for a security vulnerability. Use GitHub's private **Security → Report a vulnerability** flow for this repository.

## Security-sensitive areas

SysGlance is a local desktop application with no server, telemetry or runtime web connection. The main security boundaries are:

- Electron renderer isolation (`contextIsolation`, sandbox, disabled Node integration);
- the explicit `contextBridge` allow-list in `src/preload.js`;
- main-process validation of settings and file actions;
- the folder-opening allow-list;
- Content Security Policy with `connect-src 'none'`.

SysGlance does not expose Windows registry, Explorer, taskbar or arbitrary command-execution APIs.

## Out of scope

- Attacks requiring an already-compromised local machine.
- Cosmetic/theme defects without a security consequence.
- Vulnerabilities solely in unsupported third-party modifications.
