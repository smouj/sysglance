'use strict';

const diagnostics = require('../src/diagnostics');
const zlib = require('zlib');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

const snapshot = {
  schemaVersion: 1,
  generatedAt: '2026-09-20T00:00:00.000Z',
  recentLogs: ['loaded C:\\Users\\VersusPc\\AppData\\Roaming\\sysglance\\config.json'],
  config: { shell: { wallpaperPath: '[redacted]' } }
};
const redacted = diagnostics.redactText(snapshot.recentLogs[0], ['C:\\Users\\VersusPc']);
check('path redaction removes the local user directory', !redacted.includes('VersusPc'));
check('network identifiers are redacted from log text', !diagnostics.redactText('peer 192.168.1.10 aa:bb:cc:dd:ee:ff').match(/192\.168|aa:bb/i));
check('CRC32 matches the ZIP test vector', diagnostics.crc32(Buffer.from('123456789', 'utf8')) === 0xcbf43926);

const bundle = diagnostics.createSupportBundle(snapshot, snapshot.recentLogs, ['C:\\Users\\VersusPc']);
check('support bundle has a ZIP signature', bundle.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
check('support bundle contains all declared file names', ['manifest.json', 'diagnostics.json', 'recent-log.txt'].every((name) => bundle.includes(Buffer.from(name))));
check('support bundle does not contain the unredacted username', !bundle.includes(Buffer.from('VersusPc')));
const extracted = {};
let offset = 0;
while (bundle.readUInt32LE(offset) === 0x04034b50) {
  const method = bundle.readUInt16LE(offset + 8);
  const compressedSize = bundle.readUInt32LE(offset + 18);
  const nameLength = bundle.readUInt16LE(offset + 26);
  const extraLength = bundle.readUInt16LE(offset + 28);
  const name = bundle.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
  const dataStart = offset + 30 + nameLength + extraLength;
  const data = bundle.subarray(dataStart, dataStart + compressedSize);
  extracted[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  offset = dataStart + compressedSize;
}
check('support bundle local entries inflate and parse', extracted['manifest.json'] && JSON.parse(extracted['manifest.json']).format === 'sysglance-support-bundle' && JSON.parse(extracted['diagnostics.json']).recentLogs[0].includes('[redacted-path]'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
