# Performance findings — why the overlay cost 37% of a core

Measured on the development machine (Windows 10 22H2, 8 threads, 16 GB RAM) on 2026-09-15,
with SysGlance v1.2.0 running as the always-on-top overlay:

| Metric | Measured |
|---|---|
| Processes | 4 |
| RAM | 363.2 MB |
| CPU, sustained | **3.66 s per 10 s of wall clock** = 36.6% of one core, 4.6% of the whole machine |
| System memory at the time | 90% used (1.6 GB free of 16 GB) |

## Root causes, in order of impact

1. **`transparent: true` + `alwaysOnTop` + `frame: false`.** On Windows a transparent window
   cannot use the normal GPU composition path; Chromium falls back to software compositing and
   repaints on every change. This is the single biggest cost, and it is architectural, not
   a micro-optimisation.
2. **Layered `backdrop-filter: blur()`.** One on `body`, one per `.section`, one on the settings
   panel. Every blur re-reads what is behind the window, and every child update (a progress bar
   moving once per cycle) invalidates all of them.
3. **`will-change: transform` on every section** — allocates a compositor layer per card, for a
   layout that never animates.
4. **A `fadeSlide` animation on every section**, delayed per `nth-child`.
5. **A 1 s clock timer** — one repaint per second for a clock that only shows minutes.
6. **Unconditional DOM writes**: every cycle rewrote `textContent` for values that had not
   changed, and rebuilt the per-core grid with `innerHTML` (markup reparse + full repaint).

## What was changed, and what it measured after

The fixes were applied and verified in a build of the retired overlay branch, then reverted from
`main` during retirement (see the banner in the README). They are recorded here so the knowledge
survives the repository:

- `transparent: false` + `backgroundColor` + `backgroundThrottling: true`, normal taskbar presence,
  focusable, not always-on-top. The always-on-top glance belongs to OpenClaw Widget.
- Every `backdrop-filter`, `will-change` and per-section animation removed.
- Change-aware writes (`setText`, `setWidth`), per-core grid built once and then only the bar
  widths touched, clock at 30 s, whole update dropped while `document.hidden`.

## The lesson that outlived the app

Neither the aesthetics nor the cost were separate problems: the frosted multi-layer glass look
*was* the CPU bill. If a lightweight, always-visible overlay is the goal, the native route
(C# / WPF, one opaque window, no Chromium) wins by an order of magnitude — ~85 MB and ~0% CPU
versus ~363 MB and 37% of a core. That is why the suite now ships one app.
