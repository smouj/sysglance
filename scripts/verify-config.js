'use strict';
const assert = require('assert');
const config = require('../src/config');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(a,b,message) { assert.deepStrictEqual(a,b,message); checks++; }

const d = config.defaults();
eq(d.configVersion, 3, 'config version');
eq(d.layout, 'sidebar', 'default layout');
eq(d.theme, 'dark', 'default theme');
ok(!Object.prototype.hasOwnProperty.call(d, 'shell'), 'shell state removed');
ok(!Object.prototype.hasOwnProperty.call(d, 'compactMode'), 'compact mode removed');

const legacy = config.normalize({
  layout: 'dock', theme: 'lcd', opacity: 9, refreshInterval: 10, slowInterval: 50000,
  shell: { darkMode: true }, compactMode: true, collapsedSections: ['cpu']
});
eq(legacy.config.layout, 'dock');
eq(legacy.config.theme, 'lcd');
eq(legacy.config.opacity, 1);
eq(legacy.config.refreshInterval, config.LIMITS.refreshInterval.min);
eq(legacy.config.slowInterval, config.LIMITS.slowInterval.max);
ok(legacy.warnings.some((w) => w.includes('shell')), 'legacy shell migration warning');
ok(legacy.warnings.some((w) => w.includes('compactMode')), 'legacy compact migration warning');

eq(config.validatePatch('layout','corner').ok, true);
eq(config.validatePatch('theme','neon').ok, false);
eq(config.validatePatch('shell',{}).ok, false);
eq(config.validatePatch('__proto__',{}).ok, false);

const partial = config.normalize({ showSections: { cpu: false, gpu: false } }).config.showSections;
eq(partial.cpu, false); eq(partial.gpu, false); eq(partial.memory, true); eq(partial.network, true);
console.log('config: ' + checks + ' checks OK');
