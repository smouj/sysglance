# Windows code signing

## Development

Development builds may be unsigned. The local native helper is compiled with the in-box .NET Framework compiler and is never committed.

## Production

Production artifacts should be signed in a protected Windows CI job with a certificate stored in the CI secret store. The release workflow consumes `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`; the first should be a protected certificate reference accepted by electron-builder (for example a base64-encoded PFX secret). Private keys must never be committed or copied into `dist/`. The release job verifies the signature and records artifact hashes. `npm run verify:release` is the executable artifact gate; release tags set `SYSGLANCE_REQUIRE_SIGNING=1` and fail closed when any packaged PE, including the native helper, is unsigned.

## SmartScreen

Signing improves publisher identity but does not guarantee reputation. Publish release notes, keep the certificate stable, avoid unsigned update payloads and provide a checksum/signature verification path for portable builds.

Current status: signing and secure update are NOT IMPLEMENTED.
