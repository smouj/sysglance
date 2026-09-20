#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — privacy boundary verification');
const root = path.join(__dirname, '..');
const sourceFiles = [];
for (const dir of ['src', 'scripts']) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (name.endsWith('.js') && name !== path.basename(__filename)) sourceFiles.push(path.join(root, dir, name));
  }
}
const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const directDependencies = Object.keys(pkg.dependencies || {}).sort();

check('no outbound HTTP or telemetry primitive is present', !/\b(?:fetch|WebSocket|axios|XMLHttpRequest|http\.request|https\.request)\s*\(/.test(source));
check('no analytics or crash-reporting vendor is present', !/\b(?:sentry|posthog|segment|mixpanel|matomo|telemetry|analytics)\b/i.test(source));
check('direct runtime dependencies stay limited to the provider', directDependencies.length === 1 && directDependencies[0] === 'systeminformation', directDependencies.join(', '));
check('privacy policy states the local-only boundary', fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8').includes('no server, no telemetry, no network services'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
