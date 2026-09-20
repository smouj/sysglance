'use strict';

// Process-local lifecycle state. Electron's powerMonitor emits suspend/resume
// only after app readiness, so keeping the transition state dependency-free
// makes the pause/re-arm behavior testable without triggering real sleep.
class LifecycleState {
  constructor() {
    this.state = 'active';
    this.suspendedAt = null;
    this.resumedAt = null;
    this.suspendCount = 0;
  }

  suspend(at) {
    if (this.state === 'suspended') return false;
    this.state = 'suspended';
    this.suspendedAt = Number.isFinite(at) ? at : Date.now();
    this.suspendCount++;
    return true;
  }

  resume(at) {
    if (this.state !== 'suspended') return false;
    this.state = 'active';
    this.resumedAt = Number.isFinite(at) ? at : Date.now();
    return true;
  }

  isSuspended() {
    return this.state === 'suspended';
  }

  snapshot() {
    return {
      state: this.state,
      suspendedAt: this.suspendedAt,
      resumedAt: this.resumedAt,
      suspendCount: this.suspendCount
    };
  }
}

module.exports = { LifecycleState };
