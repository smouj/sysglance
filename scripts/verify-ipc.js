#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const mainFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const shellFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell', 'ipc.js'), 'utf8');
const mainHandlers = Array.from(mainFile.matchAll(/ipcMain\.handle\('([^']+)'/g), (m) => m[1]);
const shellHandlers = Array.from(shellFile.matchAll(/ipcMain\.handle\('([^']+)'/g), (m) => m[1]);
const handlers = mainHandlers.concat(shellHandlers);
const duplicates = handlers.filter((channel, index) => handlers.indexOf(channel) !== index);
const channelBlock = (shellFile.match(/const CHANNELS = \[(.*?)\];/s) || [])[1] || '';
const listed = Array.from(channelBlock.matchAll(/'([^']+)'/g), (m) => m[1]);
const listedDuplicates = listed.filter((channel, index) => listed.indexOf(channel) !== index);

console.log('SysGlance — IPC registration verification');
console.log('  main handlers=' + mainHandlers.length + ' shell handlers=' + shellHandlers.length + ' listed shell channels=' + listed.length);
if (duplicates.length) { console.error('  FAIL duplicate handlers: ' + duplicates.join(', ')); process.exit(1); }
if (listedDuplicates.length) { console.error('  FAIL duplicate channel declarations: ' + listedDuplicates.join(', ')); process.exit(1); }
if (handlers.length !== new Set(handlers).size) process.exit(1);
console.log('  PASS  every ipcMain.handle channel is unique');
console.log('  PASS  declared shell channel list is unique');
