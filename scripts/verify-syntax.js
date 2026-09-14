#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — syntax gate
//
// `node --check` every JavaScript file in src/ and scripts/, in one place, so
// CI and `npm run verify` cannot drift from the list of files that matter.
// Dependency-free; works from any checkout.
//
//   node scripts/verify-syntax.js      # exit 0 = every file parses
// ═══════════════════════════════════════════════════════

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROOTS = ['src', 'scripts'];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [];
for (const r of ROOTS) {
  const dir = path.join(ROOT, r);
  if (fs.existsSync(dir)) walk(dir, files);
}
files.sort();

let failed = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('  PASS  node --check ' + rel);
  } catch (err) {
    failed++;
    console.log('  FAIL  node --check ' + rel);
    const out = String((err.stderr || err.stdout || err.message)).trim();
    if (out) console.log(out.split('\n').map((l) => '        ' + l).join('\n'));
  }
}

console.log('\n' + files.length + ' file(s) checked, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
