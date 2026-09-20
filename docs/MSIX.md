# Microsoft Store / MSIX track

Status: **NOT IMPLEMENTED**. SysGlance currently ships through the independently
distributable per-user NSIS installer and the portable Windows executable. This
track is deliberately documented without changing those paths.

## Product boundary

The Store/MSIX package must remain an optional distribution channel. It must not
add an account, cloud dependency, telemetry, advertising or a mandatory
auto-update service to the Community build.

## Prerequisites before implementation

1. Choose the package identity, publisher identity and minimum Windows version;
   keep them stable across test, Store and signed production artifacts.
2. Build the MSIX/AppX package on a Windows runner and sign it with the same
   protected certificate process used for production releases. Never commit the
   certificate or private key.
3. Validate the Windows shell boundary under package identity. Registry-backed
   taskbar/theme settings, the one-shot helper, Explorer launch, Start-menu
   shortcuts and tray behavior must be tested explicitly because packaged and
   unpackaged execution have different filesystem and process constraints.
4. Define install, upgrade, rollback and uninstall behavior, including migration
   of `userData` profiles, history, logs and the shell undo journal.
5. Exercise a clean Windows 10/11 matrix: first install, upgrade from NSIS,
   upgrade from an older MSIX, uninstall residue, repair/reinstall, DPI, one to
   three displays, sleep/resume and network changes.
6. Submit only after Store metadata, privacy disclosures, signing, hashes and
   release notes have been reviewed. Independent NSIS/portable release remains
   the fallback if a Store constraint conflicts with a shell capability.

## Release gate

Do not add an `appx`/MSIX target or advertise Store availability until the
prerequisites above have executable CI checks and a clean-machine report. The
current release gate therefore remains:

```text
MSIX / Microsoft Store: NOT IMPLEMENTED
NSIS: locally verified
Portable: locally verified
```
