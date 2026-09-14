# Product positioning — OpenClaw desktop suite

> **Estado (2026-09-15):** la suite se redujo a **una** aplicación, OpenClaw Widget.
> SysGlance queda retirada; este archivo se conserva para explicar por qué se partió así y qué se aprendió.

Two desktop apps, one suite. Complementary, never competitors.

| | **SysGlance** (this repo) | **OpenClaw Widget** (https://github.com/smouj/openclaw-desktop-widget) |
|---|---|---|
| Role | On-demand control center | Always-on glance |
| Stack | Electron 33 + systeminformation | C# / WPF, .NET Framework 4.x (in-box compiler), 0 dependencies |
| Runs | Only while the user has it open | Always resident, lightweight |
| Owns | Deep dashboards (files, processes, GPU, project info) and **Shell configuration** (taskbar position, auto-hide, dark mode, accent, wallpaper) | System health readout, OpenClaw/Codex status and **the resident taskbar vibrancy effect** |
| Does not own | Resident taskbar effects | Shell configuration UI |

## Rules

1. **Only the Widget runs a resident taskbar effect.** Two processes applying window policy to the same taskbar would fight; last writer wins and both burn CPU.
2. **SysGlance configures, the Widget keeps it alive.** SysGlance must not hold a resident effect.
3. **Same brand, same visual language, different jobs.** Never ship the same screen twice.
4. **Before adding a feature, check the sibling repo.** If it belongs there, link to it instead of duplicating it.

This file is the tie-breaker for future sessions working on either repo.
