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

Follow-up after the profile/process/display integration (`npm run bench -- --iterations=5`) measured a 0.79 ms median fast cycle, 3,204.02 ms median slow cycle, 3.01× lower compute estimate and 2.21× fewer child processes versus the legacy path in that run. These are host-specific measurements, not release guarantees.

After adding adapter diagnostics, the first `--new --iterations=3` sample
measured a 0.73 ms median fast tier, 3,988.13 ms median slow tier and 25.67
child processes per slow cycle. Gateway/DNS lookup was then moved out of the
slow loop into a cached on-demand bridge. The follow-up measured 0.72 ms fast,
3,330.59 ms slow and 19.33 child processes per slow cycle. This is an explicit
guard against silently turning network identity into a 7-second polling cost.

Latest post-packaging sample (`npm run bench -- --iterations=3 --new`, same
Windows host) measured **0.69 ms median fast**, **3,149.01 ms median slow**,
**166.33 ms CPU per slow cycle** and **19.33 child processes per slow cycle**.
The sample spawned 77 children overall, mostly provider-side PowerShell calls;
this is why the slow tier remains cadence-limited and is not part of the fast
UI loop.

## Runtime smoke measurement

One normal launch on the same Windows 10 host (20 September 2026, current
working tree, no `--self-test`) reached a visible window in **1,474 ms**. After
three seconds of warm-up, a 30.3-second sample observed four processes in the
SysGlance tree and **393.3 MB combined RSS**: main 96.1 MB, renderer 144.2 MB,
GPU process 108.8 MB and utility 44.2 MB. Aggregate CPU time was 2,203 ms,
equivalent to **7.27% of one core** across the sample. The hardware cadence is
7 seconds, so this includes real provider bursts rather than pretending that
the app is idle between polls. A second shorter sample measured 1,512 ms to
window and 396.9 MB RSS; the spread shows why these are baselines, not release
guarantees. The process tree was closed after each run.

The final Windows installer from this audit is **111,918,157 bytes** with
SHA-256 `C64478FCCDA65FF9EB970BC308F58FDB1121074D3ABB63B82FE366485682D366`.
It was
built in `dist-verify` with electron-builder 26.15.3 and includes the packaged
native helper.

## Current performance controls

- Fast and slow cadences are independently configurable and clamped.
- Static hardware/OS identity is cached for the session.
- Slow collection skips hidden sections.
- Renderer updates are batched through `requestAnimationFrame` and avoid unchanged DOM writes.
- Slow and fast cycles have running guards; skipped and failed ticks are exposed in the composed metrics payload.

## NOT VERIFIED

- 60 Hz visual smoothness on a 100/125/150/175/200% DPI matrix.
- Repeated cold/warm startup distributions and time to first useful metric.
- Idle CPU/RAM distributions over a longer representative workload.
- Installed footprint, uninstall residue and frame pacing at 60 Hz.
- Sleep/resume, display hot-plug and GPU driver reset behavior.
