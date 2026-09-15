# Performance findings

SysGlance previously accumulated several expensive presentation choices at the same time: a transparent always-on-top Electron window, multiple `backdrop-filter` layers, per-card entrance animations and unconditional DOM rewrites.

A historical measurement on the development Windows machine on 2026-09-15 showed that this combination could consume a noticeable fraction of one CPU core. Treat that measurement as a warning about the old design, not as a current benchmark.

## Changes retained in the current design

- No `backdrop-filter` in the application stylesheet.
- No per-card entrance animation.
- Minute-level clock precision rather than a 1 s repaint loop.
- Guarded text and meter writes in the renderer.
- Signature caches for lists that otherwise require `innerHTML` reconstruction.
- Fast metrics collected from Node/OS APIs rather than repeated hardware shell-outs.
- Hardware queries run on a slower tier and hidden sections are skipped where possible.
- `backgroundThrottling: true` while the window is hidden.
- Three fixed-purpose layouts so the browser does not maintain a large scrolling surface.

## Remaining architectural trade-off

SysGlance intentionally remains a transparent, frame-less, always-on-top Electron overlay. That is convenient and portable, but transparent composition can cost more than an opaque native window on Windows.

For that reason, performance work should be measured instead of inferred from CSS changes.

## Reproduce metrics-tier timing

```bash
npm ci
npm run bench -- --iterations=5
```

The on-screen header also reports the last fast-cycle duration. The settings footer exposes fast and hardware cycle timings.

For whole-process CPU and memory, measure a packaged build with the operating-system task manager or a profiler; the internal benchmark measures collection cost, not Chromium/Electron composition cost.

## Guardrails

When changing the UI:

1. Do not reintroduce backdrop blur.
2. Do not add continuously animated decoration.
3. Avoid rebuilding unchanged lists or large DOM regions.
4. Keep the primary dashboard non-scrolling.
5. Compare packaged-process CPU/RAM before and after visual changes.
