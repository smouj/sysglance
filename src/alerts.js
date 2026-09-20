'use strict';

// Local alert state machine: threshold + duration + cooldown + recovery.
// It returns transitions instead of showing notifications itself so the UI,
// tray and future Windows toast adapter can choose how to present them.

const GB = 1024 * 1024 * 1024;

const DEFAULT_RULES = [
  { id: 'cpu-high', label: 'CPU above 90%', severity: 'CRITICAL', durationMs: 60000, cooldownMs: 300000, value: (s) => s.cpu, read: (s) => Number(s.cpu) >= 90 },
  { id: 'memory-high', label: 'RAM above 90%', severity: 'WARNING', durationMs: 15000, cooldownMs: 300000, value: (s) => s.memory, read: (s) => Number(s.memory) >= 90 },
  { id: 'gpu-hot', label: 'GPU above 85 °C', severity: 'WARNING', durationMs: 20000, cooldownMs: 300000, value: (s) => s.gpuTemperature, read: (s) => Number(s.gpuTemperature) >= 85 },
  { id: 'disk-low', label: 'Disk below 10 GB free', severity: 'WARNING', durationMs: 15000, cooldownMs: 900000, value: (s) => s.minDiskFree, read: (s) => Number(s.minDiskFree) < 10 * GB },
  { id: 'process-heavy', label: 'Process above 25% CPU', severity: 'WARNING', durationMs: 30000, cooldownMs: 300000, value: (s) => s.maxProcessCpu, read: (s) => Number(s.maxProcessCpu) >= 25 }
];

function clonePublic(rule, state) {
  return {
    id: rule.id,
    label: rule.label,
    severity: rule.severity,
    status: state.active ? rule.severity : state.recoveredAt ? 'RECOVERED' : 'NORMAL',
    active: state.active,
    since: state.activeSince,
    lastValue: state.lastValue,
    lastTransitionAt: state.lastTransitionAt,
    lastNotifiedAt: state.lastNotifiedAt
  };
}

class AlertEngine {
  constructor(rules) {
    this.rules = Array.isArray(rules) && rules.length ? rules.slice() : DEFAULT_RULES.slice();
    this.states = new Map();
    this.events = [];
    for (const rule of this.rules) this.states.set(rule.id, { active: false, conditionSince: null, activeSince: null, recoveredAt: null, lastValue: null, lastTransitionAt: null, lastNotifiedAt: null });
  }

  evaluate(sample, now) {
    const at = Number.isFinite(now) ? now : Date.now();
    const source = sample || {};
    const transitions = [];
    for (const rule of this.rules) {
      const state = this.states.get(rule.id);
      let condition = false;
      try { condition = !!rule.read(source); } catch (_) { condition = false; }
      try { state.lastValue = typeof rule.value === 'function' ? rule.value(source) : null; } catch (_) { state.lastValue = null; }
      if (condition) {
        if (state.conditionSince === null) state.conditionSince = at;
        if (!state.active && at - state.conditionSince >= rule.durationMs) {
          state.active = true;
          state.activeSince = at;
          state.recoveredAt = null;
          state.lastTransitionAt = at;
          const canNotify = state.lastNotifiedAt === null || at - state.lastNotifiedAt >= rule.cooldownMs;
          if (canNotify) state.lastNotifiedAt = at;
          const event = { type: 'TRIGGERED', id: rule.id, label: rule.label, severity: rule.severity, at, notify: canNotify };
          this.events.push(event);
          transitions.push(event);
        }
      } else {
        state.conditionSince = null;
        if (state.active) {
          state.active = false;
          state.recoveredAt = at;
          state.lastTransitionAt = at;
          const event = { type: 'RECOVERED', id: rule.id, label: rule.label, severity: rule.severity, at, notify: true };
          this.events.push(event);
          transitions.push(event);
        }
      }
    }
    if (this.events.length > 40) this.events.splice(0, this.events.length - 40);
    return { transitions, alerts: this.snapshot() };
  }

  snapshot() {
    const rules = {};
    for (const rule of this.rules) rules[rule.id] = clonePublic(rule, this.states.get(rule.id));
    return { active: Object.values(rules).filter((item) => item.active), rules, events: this.events.slice(-20) };
  }

  reset() {
    this.states.clear();
    this.events = [];
    for (const rule of this.rules) this.states.set(rule.id, { active: false, conditionSince: null, activeSince: null, recoveredAt: null, lastValue: null, lastTransitionAt: null, lastNotifiedAt: null });
  }
}

module.exports = { AlertEngine, DEFAULT_RULES, GB };
