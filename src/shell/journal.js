'use strict';

// Small local undo journal for shell mutations. It stores only bounded,
// JSON-safe before/after snapshots; it never stores commands or credentials.
// The journal is deliberately independent from Electron so it can be tested
// with a temporary path.

const fs = require('fs');
const path = require('path');

class ShellJournal {
  constructor(file, maxEntries) {
    this.file = file;
    this.maxEntries = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 12;
    this.entries = this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.kind === 'string').slice(0, this.maxEntries);
    } catch (_) { return []; }
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, '.' + path.basename(this.file) + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this.file);
  }

  record(kind, before, after, meta) {
    const entry = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      at: new Date().toISOString(), kind,
      before: JSON.parse(JSON.stringify(before || null)),
      after: JSON.parse(JSON.stringify(after || null)),
      meta: meta ? JSON.parse(JSON.stringify(meta)) : null
    };
    this.entries.unshift(entry);
    this.entries = this.entries.slice(0, this.maxEntries);
    try { this.save(); } catch (_) { /* an undo failure is reported by the caller */ }
    return entry;
  }

  latest() { return this.entries[0] || null; }

  remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter((item) => item.id !== id);
    if (this.entries.length !== before) {
      try { this.save(); } catch (_) { /* keep the in-memory removal */ }
      return true;
    }
    return false;
  }

  list() { return this.entries.map((item) => ({ id: item.id, at: item.at, kind: item.kind, meta: item.meta })); }
}

module.exports = { ShellJournal };
