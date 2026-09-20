# SysGlance performance baseline

Audit date: 2026-09-20  
Host: Windows 10 Pro 10.0.19045, Intel Core i7-6700 (8 logical CPUs), 16 GiB RAM.  
Command: `npm run bench` (`iterations=8`, Node 24.12.0, systeminformation 5.33.10).

## Observed measurement

| Tier | Median wall time | CPU time/cycle | Child processes |
|---|---:|---:|---:|
| Legacy cold cycle | 9,059 ms | 156 ms | 32.00/cycle |
| Legacy steady cycle (8 systeminformation calls) | 2,737 ms | 47 ms | 8.13/cycle |
| New fast tier (`node:os`) | 0.55 ms | 0 ms (rounded) | 0 |
| New slow tier | 6,499 ms | 85.75 ms | 17.75/cycle in benchmark isolation |
| New static tier | 891.95 ms once/session | — | 9 once/session |

The benchmark's systeminformation calls are intentionally measured in isolation and can spawn several platform helpers. The application schedules the slow tier every 7 seconds by default and the fast tier every 1.5 seconds.

## Derived steady-state estimate

- Legacy: 1,844.773 ms/s compute, 5.42 child processes/s.
- New: 836.061 ms/s compute, 2.54 child processes/s.
- Measured improvement: 2.21× lower compute estimate and 2.14× fewer child processes in this run.

Follow-up after the profile/process/display integration (`npm run bench -- --iterations=5`) measured a 0.79 ms median fast cycle, 3,204.02 ms median slow cycle, 3.01× lower compute estimate and 2.21× fewer child processes versus the legacy path in that run. These are host-specific measurements, not release guarantees. The benchmark does not yet measure cold/warm window startup, renderer/main RSS, GPU-process RSS, frame pacing, installer size or idle CPU over a 10-minute window. Those are release-gate measurements still required.

## Current performance controls

- Fast and slow cadences are independently configurable and clamped.
- Static hardware/OS identity is cached for the session.
- Slow collection skips hidden sections.
- Renderer updates are batched through `requestAnimationFrame` and avoid unchanged DOM writes.
- Slow and fast cycles have running guards; skipped and failed ticks are exposed in the composed metrics payload.

## NOT VERIFIED

- 60 Hz visual smoothness on a 100/125/150/175/200% DPI matrix.
- RAM split between main, renderer and GPU processes.
- Cold/warm startup time to first useful metric.
- Windows installer size and installed footprint.
- Sleep/resume, display hot-plug and GPU driver reset behavior.
