# Release checklist

1. Run `npm ci`, `npm run verify`, `npm run self-test` and `npm run bench` on a clean checkout.
2. Build the native helper and confirm it is present in `resources/SysGlanceShellHelper.exe`.
3. Build the NSIS installer on a real Windows runner; local builds may require Developer Mode for electron-builder's symlink cache.
4. Test install, first run, tray hide/show, uninstall and config/log cleanup.
5. Verify Windows 10/11 and the DPI/monitor/sleep matrix before release.
6. Sign production artifacts, generate hashes and review the dependency audit.
7. Do not enable auto-update until the manifest transport, signature verification and user control are implemented and tested.

The current checkout is not a release candidate: the local NSIS build is blocked by the host's symlink privilege and the Windows compatibility matrix is NOT VERIFIED.
