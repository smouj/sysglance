# Changelog

All notable changes to SysGlance are documented here. The project follows Semantic Versioning.

## [Unreleased]

### Changed

- Rebuilt the interface around three purpose-specific layouts: **Sidebar**, **Dock** and **Mini**.
- Removed page-level dashboard scrolling and the layout compression that caused clipping and overlaps.
- Reworked the visual hierarchy around four primary live signals: CPU, memory, GPU and network.
- Consolidated dark, light and LCD presentation into one stylesheet.
- Removed backdrop blur from the application visual system.
- Simplified settings and made the overlay interactive by default; click-through is now an explicit lock state.
- Added a UI contract gate that rejects scroll, Shell/OpenClaw regressions and layout-geometry drift.

### Removed

- Windows Shell/taskbar personalization UI and backend.
- Start menu, wallpaper, accent, folder-icon and Explorer manipulation.
- Shell IPC channels and native helper.
- Shell-specific verification/build scripts.
- Cross-project OpenClaw branding and product coupling.
- Stale screenshots and previews from the superseded interface.

### Documentation

- Rewrote README, product contract, contributing guide, IPC security model and performance notes around SysGlance's monitor-only scope.

## [1.3.0] - 2026-09-15

This release introduced the LCD theme and a large Windows Shell-personalization surface. That Shell functionality is removed again by the current unreleased refactor so SysGlance can remain a focused system glance.

It also introduced useful renderer optimizations that remain conceptually relevant: guarded DOM writes, signature-based list updates and reduced needless repaint work.

## [1.2.0] - 2026-09-15

Performance/security architecture release:

- Split metrics into static, fast and hardware tiers.
- Moved CPU/memory/uptime hot-path collection to Node/OS APIs.
- Kept `systeminformation` for slower hardware queries.
- Added renderer sandboxing, context isolation and an explicit preload bridge.
- Added configuration validation, IPC hardening and package CI.

## [1.0.0]

Initial SysGlance overlay with CPU, memory, GPU, storage, network, filesystem, process and battery monitoring.
