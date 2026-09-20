#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const file = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell', 'ipc.js'), 'utf8');
const handlers = Array.from(file.matchAll(/ipcMain\.handle\('([^']+)'/g), (m) => m[1]);
const duplicates = handlers.filter((channel, index) => handlers.indexOf(channel) !== index);
const channelBlock = (file.match(/const CHANNELS = \[(.*?)\];/s) || [])[1] || '';
const listed = Array.from(channelBlock.matchAll(/'([^']+)'/g), (m) => m[1]);
const listedDuplicates = listed.filter((channel, index) => listed.indexOf(channel) !== index);

console.log('SysGlance — IPC registration verification');
console.log('  handlers=' + handlers.length + ' listed shell channels=' + listed.length);
if (duplicates.length) { console.error('  FAIL duplicate handlers: ' + duplicates.join(', ')); process.exit(1); }
if (listedDuplicates.length) { console.error('  FAIL duplicate channel declarations: ' + listedDuplicates.join(', ')); process.exit(1); }
if (handlers.length !== new Set(handlers).size) process.exit(1);
console.log('  PASS  every ipcMain.handle channel is unique');
console.log('  PASS  declared shell channel list is unique');
