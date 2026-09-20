'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const install = fs.readFileSync(path.join(root, 'scripts', 'install-user.ps1'), 'utf8');
const uninstall = fs.readFileSync(path.join(root, 'scripts', 'uninstall-user.ps1'), 'utf8');
let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label + (detail ? '  —  ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  —  ' + detail : '')); }
}

const resources = pkg.build && Array.isArray(pkg.build.extraResources) ? pkg.build.extraResources : [];
check('build copies the uninstaller beside packaged resources', resources.some((item) => item && item.from === 'scripts/uninstall-user.ps1' && item.to === 'uninstall-user.ps1'));
check('installer registers the uninstaller beside packaged resources', install.includes("resources\\uninstall-user.ps1"));
check('uninstaller removes both shortcuts', uninstall.includes('Start Menu\\Programs\\SysGlance.lnk') && uninstall.includes("GetFolderPath('Desktop')"));
check('uninstaller removes only the SysGlance uninstall key', uninstall.includes("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SysGlance"));
check('uninstaller targets only the named per-user install directory', uninstall.includes("$env:LOCALAPPDATA 'Programs\\SysGlance'") && !uninstall.match(/Remove-Item\s+['"](?:C:\\|[A-Za-z]:\\?['"]|\$env:SystemRoot)/i));

const packageDirArg = (process.argv.find((arg) => arg.startsWith('--package-dir=')) || '').split('=')[1];
const packageDir = process.env.SYSGLANCE_PACKAGE_DIR || packageDirArg || 'dist-verify';
const unpackedUninstaller = path.join(root, packageDir, 'win-unpacked', 'resources', 'uninstall-user.ps1');
if (fs.existsSync(unpackedUninstaller)) check('current packaged app contains the uninstaller at the registered path', fs.statSync(unpackedUninstaller).size > 0);
else console.log('  INFO  packaged app check skipped — no unpacked artifact at ' + packageDir);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
