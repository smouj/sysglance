# Metric Engine

The metric engine has three cost tiers.

| Tier | Source | Default cadence | Examples |
|---|---|---:|---|
| Fast | Node `os` and small in-process reads | 1.5 s | CPU deltas, memory, uptime, load average |
| Hardware/slow | `systeminformation` | 7 s | GPU, temperatures, disks, network counters, processes, battery |
| On-demand network | `systeminformation` + local DNS lookup | user-triggered/cache | Adapter, IPv4, gateway, DNS and link speed |
| Static | cached provider calls | once/session | CPU model, OS identity, core count |

Every result carries an `at` timestamp. The composed payload carries the measured cycle costs, provider calls and backpressure counters. A slow provider failure degrades only its own fields.

## Backpressure

Each cycle has a running flag. A timer tick that arrives while its cycle is still running is coalesced and increments `skippedTicks`; it never starts a second provider batch. Failed cycles increment `failedTicks` and remain observable in the payload.

## History sampling

`HistoryStore` samples the composed values every five seconds into bounded ring buffers with a 24-hour retention ceiling. The store is local and session-scoped; it exposes summaries for the full selected window while downsampling the renderer series to at most 240 points for the selectable 1m/5m/30m/1h/6h/24h windows.

## Future provider contract

New providers should return `{ value, at, source, costMs, valid, error }` or be adapted to that shape at the slow-tier boundary. Expensive identity queries must never be attached to the fast cadence.
