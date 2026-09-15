'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_VERSION = 3;
const LAYOUTS = ['sidebar', 'dock', 'corner'];
const ANCHORS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
const THEMES = ['dark', 'light', 'lcd'];
const SECTION_KEYS = ['cpu', 'memory', 'gpu', 'filesystem', 'disks', 'network', 'processes', 'battery'];
const WRITABLE_KEYS = ['opacity', 'refreshInterval', 'slowInterval', 'theme', 'layout', 'anchor', 'showSections'];
const LIMITS = {
  opacity: { min: 0.45, max: 1 },
  refreshInterval: { min: 750, max: 5000 },
  slowInterval: { min: 5000, max: 15000 }
};

function defaults() {
  return {
    configVersion: CONFIG_VERSION,
    opacity: 0.94,
    refreshInterval: 1500,
    slowInterval: 7000,
    theme: 'dark',
    layout: 'sidebar',
    anchor: 'top-right',
    showSections: {
      cpu: true,
      memory: true,
      gpu: true,
      filesystem: true,
      disks: true,
      network: true,
      processes: true,
      battery: true
    }
  };
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return { ok: false, value: fallback };
  return { ok: true, value: Math.min(max, Math.max(min, n)) };
}

function validateKey(key, value, fallback) {
  switch (key) {
    case 'opacity': {
      const r = clampNumber(value, LIMITS.opacity.min, LIMITS.opacity.max, fallback);
      return { ok: r.ok, value: Math.round(r.value * 100) / 100 };
    }
    case 'refreshInterval': {
      const r = clampNumber(value, LIMITS.refreshInterval.min, LIMITS.refreshInterval.max, fallback);
      return { ok: r.ok, value: Math.round(r.value) };
    }
    case 'slowInterval': {
      const r = clampNumber(value, LIMITS.slowInterval.min, LIMITS.slowInterval.max, fallback);
      return { ok: r.ok, value: Math.round(r.value) };
    }
    case 'theme':
      return THEMES.includes(value) ? { ok: true, value } : { ok: false, value: fallback };
    case 'layout':
      return LAYOUTS.includes(value) ? { ok: true, value } : { ok: false, value: fallback };
    case 'anchor':
      return ANCHORS.includes(value) ? { ok: true, value } : { ok: false, value: fallback };
    case 'showSections': {
      if (!isObject(value)) return { ok: false, value: fallback };
      const out = {};
      for (const keyName of SECTION_KEYS) {
        out[keyName] = typeof value[keyName] === 'boolean' ? value[keyName] : fallback[keyName] !== false;
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false, value: fallback };
  }
}

function normalize(rawInput) {
  const base = defaults();
  const raw = isObject(rawInput) ? rawInput : {};
  const config = { ...base, showSections: { ...base.showSections } };
  const warnings = [];

  for (const key of WRITABLE_KEYS) {
    if (!hasOwn(raw, key)) continue;
    const r = validateKey(key, raw[key], base[key]);
    if (r.ok) config[key] = r.value;
    else warnings.push(key + ': invalid value, default restored');
  }

  for (const key of ['lastX', 'lastY']) {
    if (Number.isFinite(raw[key])) config[key] = Math.round(raw[key]);
  }

  if (hasOwn(raw, 'shell')) warnings.push('legacy shell settings removed in config v3');
  if (hasOwn(raw, 'collapsedSections')) warnings.push('legacy collapsedSections removed in config v3');
  if (hasOwn(raw, 'compactMode')) warnings.push('legacy compactMode removed; layouts now define density');

  config.configVersion = CONFIG_VERSION;
  return { config, warnings };
}

function validatePatch(key, value) {
  if (!WRITABLE_KEYS.includes(key)) return { ok: false, reason: 'key is not writable' };
  const base = defaults();
  const r = validateKey(key, value, base[key]);
  return { ok: r.ok, value: r.value, reason: r.ok ? null : 'invalid value for ' + key };
}

function load(file) {
  if (!fs.existsSync(file)) return { ...normalize(null), existed: false, recovered: false };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...normalize(raw), existed: true, recovered: false };
  } catch (err) {
    return {
      ...normalize(null),
      existed: true,
      recovered: true,
      warnings: ['config.json unreadable: ' + err.message]
    };
  }
}

function save(file, input) {
  const { config } = normalize(input);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return config;
}

module.exports = {
  CONFIG_VERSION,
  LAYOUTS,
  ANCHORS,
  THEMES,
  SECTION_KEYS,
  WRITABLE_KEYS,
  LIMITS,
  defaults,
  normalize,
  validateKey,
  validatePatch,
  load,
  save
};
