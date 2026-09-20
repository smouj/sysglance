# Release checklist

1. Run `npm ci`, `npm run verify`, `npm run self-test` and `npm run bench` on a clean checkout.
2. Build the native helper and confirm it is present in `resources/SysGlanceShellHelper.exe`.
3. Build the NSIS installer on a real Windows runner; this audit produced a local NSIS artifact in `dist-verify` with electron-builder 26.15.3. The default `dist/` output may still be unavailable when another Electron process holds a stale unpacked directory.
4. Test install, first run, tray hide/show, uninstall and config/log cleanup.
5. Verify Windows 10/11 and the DPI/monitor/sleep matrix before release.
6. Sign production artifacts, generate hashes and review the dependency audit.
7. Do not enable auto-update until the manifest transport, signature verification and user control are implemented and tested.

The current checkout is not a release candidate: production signing/secure update and the Windows compatibility matrix are NOT VERIFIED. The local packaging path is verified through `dist-verify`, but install/uninstall residue still needs a clean-machine test.
