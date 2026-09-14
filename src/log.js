'use strict';
// ═══════════════════════════════════════════════════════
// SysGlance — logging
//
// Console output (so `npm start` in a terminal, and the CI smoke test, see
// everything) plus a size-capped log file under userData/logs/. Nothing here
// throws: a broken log file must never take the app down.
// ═══════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;   // rotate at 512 KB, keep one previous file
const PREFIX = { info: 'INFO ', warn: 'WARN ', error: 'ERROR', debug: 'DEBUG' };

let logFile = null;
let primed = false;
let failedWrites = 0;
const recent = [];              // last few lines, for the self-test report

function prime(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'sysglance.log');
    try {
      const st = fs.statSync(logFile);
      if (st.size > MAX_BYTES) fs.renameSync(logFile, logFile + '.1');
    } catch (_) { /* no previous log */ }
    primed = true;
  } catch (_) {
    logFile = null;
    primed = false;
  }
  return logFile;
}

function isPrimed() { return primed; }
function file() { return logFile; }
function tail(n) { return recent.slice(-(n || 20)); }

function line(level, msg) {
  const text = '[' + new Date().toISOString() + '] ' + (PREFIX[level] || level) + ' ' + msg;
  recent.push(text);
  if (recent.length > 200) recent.shift();
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else if (level === 'debug') { if (process.env.SYSGLANCE_DEBUG) console.log(text); }
  else console.log(text);
  if (!logFile || failedWrites > 3) return;
  try { fs.appendFileSync(logFile, text + '\n', 'utf8'); } catch (_) { failedWrites++; }
}

const info = (msg) => line('info', msg);
const warn = (msg) => line('warn', msg);
const error = (msg) => line('error', msg);
const debug = (msg) => line('debug', msg);

/** Log an Error with its stack, plus optional context. */
function exception(where, err) {
  const detail = err && err.stack ? err.stack : String(err);
  error('uncaught in ' + where + ': ' + detail.split('\n').slice(0, 6).join(' | '));
}

module.exports = { prime, isPrimed, file, tail, info, warn, error, debug, exception, MAX_BYTES };
