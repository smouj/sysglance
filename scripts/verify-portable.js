#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageDir = process.env.SYSGLANCE_PORTABLE_DIR ||
  (process.argv.find((arg) => arg.startsWith('--portable-dir=')) || '').split('=')[1] || 'dist-portable';
const dir = path.resolve(root, packageDir);
let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — portable package verification');
const exeFiles = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /\.exe$/i.test(name)) : [];
const portable = exeFiles.map((name) => ({ name, path: path.join(dir, name) }))
  .filter((item) => fs.statSync(item.path).size > 10 * 1024 * 1024)
  .sort((a, b) => fs.statSync(b.path).size - fs.statSync(a.path).size)[0];
check('portable artifact exists', !!portable, packageDir);
if (portable) check('portable artifact is a non-trivial executable', fs.statSync(portable.path).size > 50 * 1024 * 1024, portable.name + ' (' + fs.statSync(portable.path).size + ' bytes)');
const helper = path.join(dir, 'win-unpacked', 'resources', 'SysGlanceShellHelper.exe');
if (fs.existsSync(path.join(dir, 'win-unpacked'))) {
  check('portable unpacked resources contain the native helper', fs.existsSync(helper) && fs.statSync(helper).size > 0);
} else {
  console.log('  INFO  unpacked portable resources are not exposed by this builder version');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
