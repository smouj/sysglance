'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }

for (const id of ['sec-cpu','sec-memory','sec-gpu','sec-network','sec-disks','sec-processes','sec-filesystem','sec-battery','settings-panel']) {
  ok(html.includes('id="' + id + '"'), 'missing #' + id);
}
for (const layout of ['sidebar','dock','corner']) ok(css.includes('[data-layout="' + layout + '"]'), 'missing layout ' + layout);
ok(/\.content\{[^}]*overflow:hidden/.test(css.replace(/\s+/g,'')), 'main content must not scroll');
ok(!html.includes('shell/panel'), 'shell panel removed from HTML');
ok(!preload.includes('shell:'), 'shell IPC removed from preload');
ok(!main.includes("require('./shell/"), 'shell module removed from main');
ok(!renderer.includes('sec-shell'), 'shell UI removed from renderer');
ok(!html.includes('OpenClaw'), 'OpenClaw branding removed from UI');
ok(!css.includes('backdrop-filter'), 'expensive backdrop blur removed');
ok(main.includes('w: 392'), 'sidebar geometry is explicit');
ok(main.includes('w: 304'), 'mini geometry is explicit');
ok(main.includes('h: 168'), 'dock geometry is explicit');
console.log('ui-contract: ' + checks + ' checks OK');
