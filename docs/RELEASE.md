# Release checklist

1. Run `npm ci`, `npm run verify`, `npm run self-test` and `npm run bench` on a clean checkout.
2. Build the native helper and confirm it is present in `resources/SysGlanceShellHelper.exe`.
3. Build the NSIS installer and portable executable on a real Windows runner; this audit produced local artifacts in `dist-verify` and `dist-portable` with electron-builder 26.15.3. The default `dist/` output may still be unavailable when another Electron process holds a stale unpacked directory.
4. Test install, first run, tray hide/show, uninstall and config/log cleanup.
5. Verify Windows 10/11 and the DPI/monitor/sleep matrix before release.
6. Sign production artifacts, generate hashes and review the dependency audit.
7. Do not enable auto-update until the manifest transport, signature verification and user control are implemented and tested.

The hardware and clean-install evidence ledger is maintained in
`docs/COMPATIBILITY_MATRIX.md`; do not replace its `NOT VERIFIED` rows with
assumptions based on the local developer workstation.

The current checkout is not a release candidate: production signing/secure update and the Windows compatibility matrix are NOT VERIFIED. The local NSIS and portable packaging paths are verified, but install/uninstall residue still needs a clean-machine test.

The Microsoft Store/MSIX path is intentionally documented but **NOT IMPLEMENTED**;
see [`MSIX.md`](MSIX.md). It must not be advertised or added to the release
workflow until its package identity, signing, shell boundary and clean-machine
upgrade/uninstall matrix have executable evidence.
