#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../src/config');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — display verification');
const defaults = config.defaults();
check('display preference defaults to primary fallback', defaults.displayId === null);
check('safe display ID is accepted', config.validatePatch('displayId', 123).ok);
check('negative display ID is rejected', !config.validatePatch('displayId', -1).ok);
check('fractional display ID is rejected', !config.validatePatch('displayId', 1.5).ok);
check('display preference is writable through settings', config.WRITABLE_KEYS.includes('displayId'));

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
check('geometry uses the selected display work area', main.includes('getTargetDisplay()') && main.includes('display.workArea'));
check('topology includes scale and work-area metadata', main.includes('scaleFactor: display.scaleFactor') && main.includes('workArea:'));
check('display hotplug falls back safely', main.includes("display-removed") && main.includes("config.displayId = null"));
check('renderer exposes a target-display selector', renderer.includes("id=\"display-options\"") || renderer.includes('displayOptions'));
check('renderer exposes selected display topology summary', renderer.includes('display-summary') && renderer.includes('refreshRate') && renderer.includes('rotation'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
