#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../src/log');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

console.log('SysGlance — logging verification');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sysglance-log-'));
const activePath = path.join(tempDir, 'sysglance.log');
const rotatedPath = activePath + '.1';

try {
  fs.writeFileSync(activePath, Buffer.alloc(log.MAX_BYTES + 1, 0x41));
  check('prime rotates an oversized active log', log.prime(tempDir) === activePath && fs.existsSync(rotatedPath) && !fs.existsSync(activePath));
  log.info('verification marker');
  check('logging recreates the active file after rotation', fs.existsSync(activePath) && fs.statSync(activePath).size > 0);
  check('recent tail contains the verification marker', log.tail(1).some((line) => line.includes('verification marker')));
  check('rotated log stays at or above the configured cap', fs.statSync(rotatedPath).size >= log.MAX_BYTES);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
