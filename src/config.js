'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — configuration: defaults, validation, persistence
//
// One owner for every setting: the shape, the allowed range and the write
// path. Anything loaded from disk or received over IPC goes through
// `normalize()`, so a hand-edited (or corrupted) config.json can never put
// the app into an invalid state, and the renderer cannot persist unknown keys.
//
// Dependency-free on purpose: `node scripts/verify-config.js` requires this
// file directly, with no Electron and no npm packages.
// ═══════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// Bump when the persisted shape changes in a way that needs migration.
const CONFIG_VERSION = 2;

const LAYOUTS = ['sidebar', 'dock', 'corner'];
const ANCHORS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
const THEMES = ['dark', 'light'];
const SECTION_KEYS = ['cpu', 'memory', 'gpu', 'filesystem', 'disks', 'network', 'processes', 'battery'];
// Cards the user may fold away. `shell` is injected by src/shell/panel.js, so it
// is a collapsible view too even though it is not a metrics section.
const COLLAPSIBLE_KEYS = SECTION_KEYS.concat(['shell']);

// Refresh cadences. The fast tier is in-process (`os` module only, see
// src/metrics.js); the slow tier is the systeminformation hardware tier.
const LIMITS = {
  opacity: { min: 0.2, max: 1 },
  refreshInterval: { min: 500, max: 5000 },   // fast tier, ms
  slowInterval: { min: 5000, max: 10000 },    // hardware tier, ms
  fontSize: { min: 11, max: 16 }
};

// Keys a renderer is allowed to write through `set-config`.
const WRITABLE_KEYS = ['opacity', 'refreshInterval', 'slowInterval', 'fontSize', 'compactMode', 'showFilesystem', 'theme', 'layout', 'anchor', 'showSections', 'collapsedSections'];

// Shell state. SysGlance *configures* Windows and remembers what it wrote;
// it never keeps a resident effect alive (that is OpenClaw Widget's job — see
// PRODUCT.md at the repo root).
function defaultShell() {
  return {
    taskbarPosition: null,   // 0..3, last value written (null = untouched)
    autoHide: null,          // last value written
    darkMode: null,          // last value written
    accentAuto: false,
    accent: null,            // { r, g, b, hex }
    wallpaperPath: null,
    restartRequired: false
  };
}

function defaults() {
  return {
    configVersion: CONFIG_VERSION,
    opacity: 0.90,
    refreshInterval: 1500,
    slowInterval: 7000,
    compactMode: false,
    showFilesystem: true,
    theme: 'dark',
    layout: 'sidebar',
    anchor: 'top-right',
    fontSize: 13,
    showSections: { cpu: true, memory: true, gpu: true, filesystem: true, disks: true, network: true, processes: true, battery: true },
    collapsedSections: [],
    shell: defaultShell()
  };
}

// ── helpers ──────────────────────────────────────────────
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Never let a config file pick up an inherited property.
function safeKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = obj[k];
  }
  return out;
}

function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, value: fallback };
  return { ok: true, value: Math.min(max, Math.max(min, n)) };
}

// ── validation ───────────────────────────────────────────
// Returns { ok, value }. `fallback` is used when the input is unusable.
function validateKey(key, value, fallback) {
  switch (key) {
    case 'opacity': {
      const r = clampNumber(value, LIMITS.opacity.min, LIMITS.opacity.max, fallback);
      return { ok: r.ok, value: r.ok ? Math.round(r.value * 100) / 100 : fallback };
    }
    case 'refreshInterval': {
      const r = clampNumber(value, LIMITS.refreshInterval.min, LIMITS.refreshInterval.max, fallback);
      return { ok: r.ok, value: r.ok ? Math.round(r.value) : fallback };
    }
    case 'slowInterval': {
      const r = clampNumber(value, LIMITS.slowInterval.min, LIMITS.slowInterval.max, fallback);
      return { ok: r.ok, value: r.ok ? Math.round(r.value) : fallback };
    }
    case 'fontSize': {
      const r = clampNumber(value, LIMITS.fontSize.min, LIMITS.fontSize.max, fallback);
      return { ok: r.ok, value: r.ok ? Math.round(r.value) : fallback };
    }
    case 'compactMode':
    case 'showFilesystem':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, value: fallback };
    case 'theme':
      return THEMES.includes(value) ? { ok: true, value } : { ok: false, value: fallback };
    case 'layout':
      return LAYOUTS.includes(value) ? { ok: true, value } : { ok: false, value: fallback };
    case 'anchor':
      return ANCHORS.includes(value) ? { ok: true, value } : { ok: false, value: fallback };
    case 'showSections': {
      if (!isPlainObject(value)) return { ok: false, value: fallback };
      const out = {};
      for (const s of SECTION_KEYS) out[s] = typeof value[s] === 'boolean' ? value[s] : (fallback[s] !== false);
      return { ok: true, value: out };
    }
    case 'collapsedSections': {
      if (!Array.isArray(value)) return { ok: false, value: fallback };
      const out = [];
      for (const k of value) {
        if (typeof k === 'string' && COLLAPSIBLE_KEYS.includes(k) && !out.includes(k)) out.push(k);
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false, value: fallback };
  }
}

function normalizeShell(raw) {
  const base = defaultShell();
  const warnings = [];
  if (!isPlainObject(raw)) return { shell: base, warnings };

  const out = { ...base };
  if (raw.taskbarPosition !== undefined && raw.taskbarPosition !== null) {
    const p = raw.taskbarPosition;
    if (p === 0 || p === 1 || p === 2 || p === 3) out.taskbarPosition = p;
    else warnings.push('shell.taskbarPosition: expected 0..3, got ' + JSON.stringify(p));
  }
  for (const k of ['autoHide', 'darkMode', 'accentAuto', 'restartRequired']) {
    if (raw[k] !== undefined && raw[k] !== null) {
      if (typeof raw[k] === 'boolean') out[k] = raw[k];
      else warnings.push('shell.' + k + ': expected boolean, got ' + JSON.stringify(raw[k]));
    }
  }
  if (isPlainObject(raw.accent)) {
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255 ? Math.round(v) : null);
    const r = n(raw.accent.r), g = n(raw.accent.g), b = n(raw.accent.b);
    const hex = typeof raw.accent.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent.hex) ? raw.accent.hex.toLowerCase() : null;
    if (r !== null && g !== null && b !== null && hex) out.accent = { r, g, b, hex };
    else warnings.push('shell.accent: invalid colour, dropped');
  } else if (raw.accent !== undefined && raw.accent !== null) {
    warnings.push('shell.accent: expected { r, g, b, hex }, got ' + typeof raw.accent);
  }
  if (typeof raw.wallpaperPath === 'string' && raw.wallpaperPath.trim()) {
    // Constrained to an absolute path: the value is handed to reg.exe and to
    // our native helper, so a relative or crafted path is refused up front.
    const p = raw.wallpaperPath.trim();
    if (path.isAbsolute(p)) out.wallpaperPath = p;
    else warnings.push('shell.wallpaperPath: refused non-absolute path');
  } else if (raw.wallpaperPath) {
    warnings.push('shell.wallpaperPath: expected a string');
  }
  return { shell: out, warnings };
}

/**
 * Normalize anything (fresh defaults, a parsed config.json, a partial patch)
 * into a complete, valid config object.
 * Unknown keys are dropped; invalid values fall back to the default and are
 * reported in `warnings` so the caller can log them.
 */
function normalize(rawInput) {
  const base = defaults();
  const warnings = [];
  const raw = isPlainObject(rawInput) ? safeKeys(rawInput) : {};

  const out = { ...base, shell: base.shell };
  for (const key of WRITABLE_KEYS) {
    if (!hasOwn(raw, key)) continue;
    const r = validateKey(key, raw[key], base[key]);
    if (r.ok) out[key] = r.value;
    else warnings.push(key + ': invalid value, kept default (' + JSON.stringify(raw[key]) + ')');
  }

  const shellRes = normalizeShell(raw.shell);
  out.shell = shellRes.shell;
  warnings.push(...shellRes.warnings);

  // Persisted window position (written by the main process on `moved`).
  for (const k of ['lastX', 'lastY']) {
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = Math.round(raw[k]);
  }
  if (typeof raw.configVersion === 'number') out.configVersion = CONFIG_VERSION;

  // Keys present in the file but not in the schema are reported once.
  const known = new Set([...WRITABLE_KEYS, 'shell', 'lastX', 'lastY', 'configVersion']);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length) warnings.push('dropped unknown key(s): ' + unknown.join(', '));

  return { config: out, warnings };
}

/** Validate a single renderer-supplied patch. Returns { ok, value, reason }. */
function validatePatch(key, value) {
  if (!WRITABLE_KEYS.includes(key) && key !== 'shell') {
    return { ok: false, value: undefined, reason: 'key "' + key + '" is not writable' };
  }
  if (key === 'shell') {
    const r = normalizeShell(value);
    return { ok: true, value: r.shell, reason: null, warnings: r.warnings };
  }
  const r = validateKey(key, value, defaults()[key]);
  return { ok: r.ok, value: r.value, reason: r.ok ? null : 'invalid value for ' + key };
}

// ── persistence ──────────────────────────────────────────
function load(file) {
  let raw = null;
  let existed = false;
  try {
    if (fs.existsSync(file)) {
      existed = true;
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    const { config } = normalize(null);
    return { config, warnings: ['config.json unreadable (' + err.message + ') — using defaults'], existed, recovered: true };
  }
  const res = normalize(raw);
  return { ...res, existed, recovered: existed && !raw };
}

/** Atomic write: temp file in the same directory + rename. */
function save(file, config) {
  const { config: clean } = normalize(config);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return clean;
}

module.exports = {
  CONFIG_VERSION, LAYOUTS, ANCHORS, THEMES, SECTION_KEYS, COLLAPSIBLE_KEYS, LIMITS, WRITABLE_KEYS,
  defaults, defaultShell, normalize, validateKey, validatePatch, load, save
};
