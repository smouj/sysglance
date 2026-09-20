# Windows code signing

## Development

Development builds may be unsigned. The local native helper is compiled with the in-box .NET Framework compiler and is never committed.

## Production

Production artifacts should be signed in a protected Windows CI job with a certificate stored in the CI secret store. Private keys must never be committed or copied into `dist/`. The release job should verify the signature and record the certificate subject, timestamp and artifact hashes.

## SmartScreen

Signing improves publisher identity but does not guarantee reputation. Publish release notes, keep the certificate stable, avoid unsigned update payloads and provide a checksum/signature verification path for portable builds.

Current status: signing and secure update are NOT IMPLEMENTED.
