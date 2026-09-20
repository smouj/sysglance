'use strict';

// Bounded, session-local metric history. The store deliberately has no file or
// network dependency: it cannot grow without limit and it never leaves the
// machine. Persistence can be added behind this interface later without making
// the renderer or metric providers aware of storage details.

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5000;
const SERIES = ['cpu', 'memory', 'gpu', 'vram', 'temperature', 'gpuTemperature', 'networkRx', 'networkTx'];

class RingBuffer {
  constructor(capacity) {
    this.capacity = Math.max(2, Math.floor(capacity));
    this.values = new Array(this.capacity);
    this.start = 0;
    this.length = 0;
  }

  push(value) {
    const index = (this.start + this.length) % this.capacity;
    this.values[index] = value;
    if (this.length < this.capacity) this.length++;
    else this.start = (this.start + 1) % this.capacity;
  }

  toArray() {
    const out = new Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.values[(this.start + i) % this.capacity];
    return out;
  }

  prune(before) {
    while (this.length && this.values[this.start].at < before) {
      this.values[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.length--;
    }
  }

  get size() { return this.length; }
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function summarize(points) {
  if (!points.length) return { latest: null, average: null, peak: null, count: 0 };
  let total = 0;
  let peak = -Infinity;
  for (const point of points) {
    total += point.value;
    if (point.value > peak) peak = point.value;
  }
  return {
    latest: points[points.length - 1].value,
    average: +(total / points.length).toFixed(2),
    peak: +peak.toFixed(2),
    count: points.length
  };
}

// The store keeps every bounded sample for accurate summaries, but SVG
// sparklines should never receive tens of thousands of vertices after a 24h
// selection. Average buckets preserve the trend while keeping renderer work
// predictable on low-end Windows machines.
function downsample(points, maxPoints) {
  const limit = Math.max(2, Math.floor(maxPoints || 240));
  if (points.length <= limit) return points.slice();
  const bucketSize = Math.ceil(points.length / limit);
  const out = [];
  for (let start = 0; start < points.length; start += bucketSize) {
    const bucket = points.slice(start, start + bucketSize);
    const value = bucket.reduce((sum, point) => sum + point.value, 0) / bucket.length;
    out.push({ at: bucket[bucket.length - 1].at, value: +value.toFixed(2) });
  }
  return out;
}

class HistoryStore {
  constructor(options) {
    const opts = options || {};
    this.intervalMs = Math.max(250, Number(opts.intervalMs) || DEFAULT_INTERVAL_MS);
    this.retentionMs = Math.max(this.intervalMs, Number(opts.retentionMs) || DEFAULT_RETENTION_MS);
    this.capacity = Math.ceil(this.retentionMs / this.intervalMs) + 1;
    this.buffers = Object.create(null);
    for (const name of SERIES) this.buffers[name] = new RingBuffer(this.capacity);
    this.lastAt = 0;
  }

  record(sample, at) {
    const now = Number.isFinite(at) ? at : Date.now();
    if (this.lastAt && now - this.lastAt < this.intervalMs) return false;
    this.lastAt = now;
    const source = sample || {};
    const values = {
      cpu: finite(source.cpu),
      memory: finite(source.memory),
      gpu: finite(source.gpu),
      vram: finite(source.vram),
      temperature: finite(source.temperature),
      gpuTemperature: finite(source.gpuTemperature),
      networkRx: finite(source.networkRx),
      networkTx: finite(source.networkTx)
    };
    for (const name of SERIES) {
      if (values[name] !== null) this.buffers[name].push({ at: now, value: values[name] });
    }
    this.prune(now);
    return true;
  }

  prune(now) {
    const before = now - this.retentionMs;
    for (const name of SERIES) this.buffers[name].prune(before);
  }

  series(name, windowMs, now) {
    if (!this.buffers[name]) return [];
    const cutoff = (Number.isFinite(now) ? now : Date.now()) - Math.max(0, Number(windowMs) || this.retentionMs);
    return this.buffers[name].toArray().filter((point) => point.at >= cutoff);
  }

  snapshot(windowMs, now) {
    const current = Number.isFinite(now) ? now : Date.now();
    const window = Math.min(this.retentionMs, Math.max(this.intervalMs, Number(windowMs) || 60 * 60 * 1000));
    const series = {};
    const summary = {};
    for (const name of SERIES) {
      const full = this.series(name, window, current);
      series[name] = downsample(full, 240);
      summary[name] = summarize(full);
    }
    return { intervalMs: this.intervalMs, retentionMs: this.retentionMs, windowMs: window, series, summary };
  }

  clear() {
    for (const name of SERIES) this.buffers[name] = new RingBuffer(this.capacity);
    this.lastAt = 0;
  }
}

module.exports = { HistoryStore, RingBuffer, SERIES, summarize, downsample };
