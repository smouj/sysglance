# Local alerts

Alerts are local state transitions, not scareware. The current engine evaluates:

- CPU at or above 90% for 60 seconds — critical.
- RAM at or above 90% for 15 seconds — warning.
- GPU temperature at or above 85 °C for 20 seconds — warning.
- Any volume below 10 GB free for 15 seconds — warning.
- A process at or above 25% CPU for 30 seconds — warning.

Every rule has a duration and cooldown. A condition must remain true before it triggers, repeated triggers are suppressed during cooldown, and clearing the condition emits `RECOVERED`. The engine stores only a bounded transition list and does not contact a server.

The current renderer shows objective System Status rows. Windows toast/tray presentation is deliberately a later adapter so the domain engine remains testable and notification spam can be reviewed separately.
