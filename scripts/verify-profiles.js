#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const profiles = require('../src/profiles');
const config = require('../src/config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sysglance-profiles-'));
const store = path.join(root, 'profiles.json');
const exported = path.join(root, 'work.json');
let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — profiles verification');
check('safe names are accepted', profiles.validateName('Work-2026').ok);
check('path traversal names are refused', !profiles.validateName('../secrets').ok);
check('empty names are refused', !profiles.validateName('   ').ok);

const base = config.defaults();
base.theme = 'light'; base.layout = 'dock'; base.collapsedSections = ['health'];
const saved = profiles.upsert(store, 'Work', base);
check('save creates a profile', saved.ok);
check('list returns one profile', profiles.list(store).length === 1);
check('get returns normalized config', profiles.get(store, 'work').profile.config.theme === 'light');
check('duplicate creates a second profile', profiles.duplicate(store, 'Work', 'Gaming').ok && profiles.list(store).length === 2);
check('rename preserves profile data', profiles.rename(store, 'Gaming', 'Play').ok && profiles.get(store, 'Play').profile.config.layout === 'dock');
check('export writes a JSON artifact', profiles.exportProfile(store, 'Work', exported).ok && fs.existsSync(exported));
check('remove deletes only the selected profile', profiles.remove(store, 'Play').ok && profiles.list(store).length === 1);
check('import restores the exported profile', profiles.remove(store, 'Work').ok && profiles.importProfile(store, exported).ok && profiles.list(store).length === 1);

fs.writeFileSync(store, '{broken', 'utf8');
check('corrupt store recovers empty', profiles.load(store).recovered && profiles.list(store).length === 0);

fs.rmSync(root, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
