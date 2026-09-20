'use strict';

// Local, versioned desktop profiles. The store is deliberately independent of
// Electron so it can be verified with hostile names, corrupt files and atomic
// persistence before it is exposed through IPC.

const fs = require('fs');
const path = require('path');
const configModule = require('./config');

const PROFILE_VERSION = 1;
const PROFILE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;
const PROFILE_CONFIG_KEYS = [
  'opacity', 'refreshInterval', 'slowInterval', 'fontSize', 'compactMode',
  'showFilesystem', 'theme', 'layout', 'anchor', 'showSections', 'collapsedSections', 'shell'
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function validateName(name) {
  if (typeof name !== 'string') return { ok: false, error: 'profile name must be a string' };
  const clean = name.trim();
  if (!PROFILE_NAME.test(clean) || clean === '.' || clean === '..') {
    return { ok: false, error: 'profile name must be 1–40 letters, numbers, spaces, _ or -' };
  }
  return { ok: true, value: clean };
}

function snapshotConfig(config) {
  const clean = configModule.normalize(config).config;
  const out = {};
  for (const key of PROFILE_CONFIG_KEYS) out[key] = clone(clean[key]);
  return out;
}

function normalizeProfile(raw, fallbackName) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const nameResult = validateName(source.name !== undefined ? source.name : fallbackName);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };
  const now = Date.now();
  const cfg = snapshotConfig(source.config || source);
  return {
    ok: true,
    profile: {
      version: PROFILE_VERSION,
      name: nameResult.value,
      createdAt: Number.isFinite(source.createdAt) ? source.createdAt : now,
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : now,
      config: cfg
    }
  };
}

function emptyStore() { return { version: PROFILE_VERSION, profiles: [] }; }

function normalizeStore(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.profiles)) return out;
  const seen = new Set();
  for (const item of raw.profiles) {
    const normalized = normalizeProfile(item);
    if (!normalized.ok || seen.has(normalized.profile.name.toLowerCase())) continue;
    seen.add(normalized.profile.name.toLowerCase());
    out.profiles.push(normalized.profile);
  }
  return out;
}

function load(file) {
  try {
    if (!fs.existsSync(file)) return { store: emptyStore(), existed: false, recovered: false, warnings: [] };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const store = normalizeStore(raw);
    const dropped = raw && Array.isArray(raw.profiles) ? raw.profiles.length - store.profiles.length : 0;
    return { store, existed: true, recovered: false, warnings: dropped ? ['dropped ' + dropped + ' invalid or duplicate profile(s)'] : [] };
  } catch (err) {
    return { store: emptyStore(), existed: true, recovered: true, warnings: ['profiles file unreadable (' + err.message + ') — using empty store'] };
  }
}

function save(file, store) {
  const clean = normalizeStore(store);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return clean;
}

function list(file) { return load(file).store.profiles.map((profile) => ({ name: profile.name, createdAt: profile.createdAt, updatedAt: profile.updatedAt })); }

function get(file, name) {
  const check = validateName(name);
  if (!check.ok) return { ok: false, error: check.error };
  const found = load(file).store.profiles.find((profile) => profile.name.toLowerCase() === check.value.toLowerCase());
  return found ? { ok: true, profile: clone(found) } : { ok: false, error: 'profile not found' };
}

function upsert(file, name, config) {
  const normalized = normalizeProfile({ name, config });
  if (!normalized.ok) return normalized;
  const loaded = load(file);
  const profile = normalized.profile;
  const index = loaded.store.profiles.findIndex((item) => item.name.toLowerCase() === profile.name.toLowerCase());
  if (index >= 0) {
    profile.createdAt = loaded.store.profiles[index].createdAt;
    loaded.store.profiles[index] = profile;
  } else loaded.store.profiles.push(profile);
  save(file, loaded.store);
  return { ok: true, profile: clone(profile), replaced: index >= 0 };
}

function remove(file, name) {
  const check = validateName(name);
  if (!check.ok) return { ok: false, error: check.error };
  const loaded = load(file);
  const before = loaded.store.profiles.length;
  loaded.store.profiles = loaded.store.profiles.filter((item) => item.name.toLowerCase() !== check.value.toLowerCase());
  if (loaded.store.profiles.length === before) return { ok: false, error: 'profile not found' };
  save(file, loaded.store);
  return { ok: true, name: check.value };
}

function rename(file, oldName, newName) {
  const oldCheck = validateName(oldName), newCheck = validateName(newName);
  if (!oldCheck.ok) return { ok: false, error: oldCheck.error };
  if (!newCheck.ok) return { ok: false, error: newCheck.error };
  const loaded = load(file);
  const item = loaded.store.profiles.find((profile) => profile.name.toLowerCase() === oldCheck.value.toLowerCase());
  if (!item) return { ok: false, error: 'profile not found' };
  if (loaded.store.profiles.some((profile) => profile.name.toLowerCase() === newCheck.value.toLowerCase() && profile !== item)) return { ok: false, error: 'profile already exists' };
  item.name = newCheck.value;
  item.updatedAt = Date.now();
  save(file, loaded.store);
  return { ok: true, profile: clone(item) };
}

function duplicate(file, sourceName, targetName) {
  const found = get(file, sourceName);
  if (!found.ok) return found;
  return upsert(file, targetName, found.profile.config);
}

function exportProfile(file, name, destination) {
  const found = get(file, name);
  if (!found.ok) return found;
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) return { ok: false, error: 'export path must be absolute' };
  fs.writeFileSync(destination, JSON.stringify(found.profile, null, 2) + '\n', 'utf8');
  return { ok: true, path: destination, name: found.profile.name };
}

function importProfile(file, source) {
  if (typeof source !== 'string' || !path.isAbsolute(source)) return { ok: false, error: 'import path must be absolute' };
  try {
    const normalized = normalizeProfile(JSON.parse(fs.readFileSync(source, 'utf8')));
    if (!normalized.ok) return normalized;
    return upsert(file, normalized.profile.name, normalized.profile.config);
  }
  catch (err) { return { ok: false, error: 'profile import failed: ' + err.message }; }
}

module.exports = {
  PROFILE_VERSION, PROFILE_CONFIG_KEYS, validateName, snapshotConfig, normalizeProfile,
  normalizeStore, load, save, list, get, upsert, remove, rename, duplicate, exportProfile, importProfile
};
