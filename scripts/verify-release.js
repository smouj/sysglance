'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function argValue(name) {
  const prefix = '--' + name + '=';
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

const packageDir = path.resolve(root, process.env.SYSGLANCE_PACKAGE_DIR || argValue('package-dir') || 'dist');
const portableDir = path.resolve(root, process.env.SYSGLANCE_PORTABLE_DIR || argValue('portable-dir') || 'dist-portable');
const requireSigning = process.env.SYSGLANCE_REQUIRE_SIGNING === '1' || process.argv.includes('--require-signing');
let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label + (detail ? '  —  ' + detail : ''));
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : ''));
  }
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function findExact(dir, name) {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? file : null;
}

function existing(file) {
  return fs.existsSync(file) ? file : null;
}

function signatureStatus(file) {
  if (process.platform !== 'win32') return 'unsupported-platform';
  try {
    const literal = file.replace(/'/g, "''");
    const module = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules', 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Security.psd1').replace(/'/g, "''");
    const command = `Import-Module -Name '${module}' -ErrorAction Stop; Get-AuthenticodeSignature -LiteralPath '${literal}' | Select-Object -ExpandProperty Status`;
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const powershell = process.env.WINDIR
      ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    return execFileSync(powershell, [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return 'error:' + (err.code || err.status || 'unknown');
  }
}

const version = String(pkg.version || '0.0.0');
const setup = findExact(packageDir, `SysGlance-Setup-${version}.exe`);
const portable = findExact(portableDir, `SysGlance-${version}-x64-portable.exe`);
const unpacked = path.join(packageDir, 'win-unpacked');
const unpackedPortable = path.join(portableDir, 'win-unpacked');

check('versioned NSIS artifact exists', !!setup, setup || packageDir);
check('versioned portable artifact exists', !!portable, portable || portableDir);

for (const [label, file] of [['NSIS artifact', setup], ['portable artifact', portable]]) {
  if (!file) continue;
  const stat = fs.statSync(file);
  const header = Buffer.alloc(2);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, header, 0, 2, 0);
  fs.closeSync(fd);
  check(label + ' is a non-trivial PE executable', stat.size > 1024 * 1024 && header.toString('ascii') === 'MZ', `${stat.size} bytes`);
  console.log('  INFO  ' + label + ' SHA-256 ' + fileHash(file));
}

check('packaged native helper exists', fs.existsSync(path.join(unpacked, 'resources', 'SysGlanceShellHelper.exe')));
check('packaged uninstaller exists', fs.existsSync(path.join(unpacked, 'resources', 'uninstall-user.ps1')));

if (requireSigning) {
  const signedFiles = [
    ['NSIS artifact', setup],
    ['portable artifact', portable],
    ['packaged app executable', existing(path.join(unpacked, 'SysGlance.exe'))],
    ['packaged native helper', existing(path.join(unpacked, 'resources', 'SysGlanceShellHelper.exe'))],
    ['portable app executable', existing(path.join(unpackedPortable, 'SysGlance.exe'))],
    ['portable native helper', existing(path.join(unpackedPortable, 'resources', 'SysGlanceShellHelper.exe'))]
  ];
  for (const [label, file] of signedFiles) {
    const status = file ? signatureStatus(file) : 'missing';
    check(label + ' has a valid Authenticode signature', status === 'Valid', status);
  }
} else {
  console.log('  INFO  signature gate skipped; set SYSGLANCE_REQUIRE_SIGNING=1 for release tags');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
