# SysGlance — product contract

SysGlance is a **small, on-demand system glance**. Its job is to show useful machine state quickly without becoming another system-tweaking suite.

## Owns

- CPU load, temperature and per-core activity.
- Memory and swap usage.
- GPU load, temperature and VRAM when available.
- Network throughput.
- Storage usage.
- Top processes.
- Standard home-folder shortcuts.
- Battery state when present.
- Three presentation modes: **Sidebar**, **Dock** and **Mini**.
- Dark, light and LCD presentation themes.

## Does not own

SysGlance must **not** change or persist Windows shell personalization. In particular it must not manage:

- taskbar position, auto-hide, transparency or vibrancy;
- Start menu settings;
- Windows accent or dark-mode registry values;
- wallpaper application;
- folder icons or `desktop.ini` customization;
- Explorer restarts;
- any resident desktop effect.

If a future feature requires registry writes, Explorer manipulation or a native helper unrelated to metrics, it belongs outside this repository.

## UI contract

1. The main dashboard does not use page-level scrolling.
2. Layouts are purpose-built, not one oversized screen squeezed into three sizes.
3. **Sidebar** prioritizes CPU, memory, GPU and network, with compact detail cards below.
4. **Dock** is a horizontal glance strip.
5. **Mini** shows only the four live primary signals.
6. Missing hardware degrades cleanly instead of leaving broken space.
7. The overlay is interactive by default; position lock is explicit.
8. No external fonts, web views, telemetry or network calls are required at runtime.

## Performance contract

Metrics stay split into tiers:

- **Fast tier:** Node `os`, approximately every 1.5 s by default.
- **Hardware tier:** `systeminformation`, approximately every 7 s by default.
- Hidden sections are not queried by the hardware tier where possible.
- Renderer updates avoid unnecessary DOM rewrites.

## Architecture

```text
Electron main
  ├─ config.js       validated local settings
  ├─ metrics.js      static / fast / hardware collection
  ├─ preload.js      narrow contextBridge API
  └─ renderer.js     presentation only
```

The repository intentionally contains no Windows Shell configuration subsystem.
