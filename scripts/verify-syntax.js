'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const files = ['src/main.js','src/preload.js','src/renderer.js','src/config.js','src/metrics.js','src/log.js','scripts/verify-config.js','scripts/verify-ui.js','scripts/bench-metrics.js'];
let checked = 0;
for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Error('missing required file: ' + rel);
  cp.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  checked++;
}
console.log('syntax: ' + checked + '/' + files.length + ' files OK');
