'use strict';

// Small dependency-free support-bundle writer. Keeping this local avoids a
// second archive runtime in the packaged app and makes the bundle format
// inspectable with any standard ZIP reader.

const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function zip(entries) {
  const now = dosDateTime(new Date());
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const method = compressed.length < raw.length ? 8 : 0;
    const data = method ? compressed : raw;
    const checksum = crc32(raw);
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(now.time, 10);
    header.writeUInt16LE(now.date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    name.copy(header, 30);
    local.push(header, data);

    const directory = Buffer.alloc(46 + name.length);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(now.time, 12);
    directory.writeUInt16LE(now.date, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    name.copy(directory, 46);
    central.push(directory);
    offset += header.length + data.length;
  }
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralData, end]);
}

function redactText(text, replacements) {
  let result = String(text || '');
  for (const value of replacements || []) {
    if (!value || value.length < 3) continue;
    result = result.split(value).join('[redacted-path]');
  }
  return result
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/gi, '[redacted-user-path]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi, '[redacted-mac]');
}

function createSupportBundle(snapshot, recentLogs, replacements) {
  const safeSnapshot = JSON.parse(JSON.stringify(snapshot || {}));
  const logs = (Array.isArray(recentLogs) ? recentLogs : []).map((line) => redactText(line, replacements));
  safeSnapshot.recentLogs = logs;
  const generatedAt = safeSnapshot.generatedAt || new Date().toISOString();
  const manifest = {
    format: 'sysglance-support-bundle',
    schemaVersion: 1,
    generatedAt,
    files: ['manifest.json', 'diagnostics.json', 'recent-log.txt'],
    privacy: 'No document contents, serial numbers, MAC addresses, IP addresses or unredacted user paths are intentionally included.'
  };
  return zip([
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' },
    { name: 'diagnostics.json', data: JSON.stringify(safeSnapshot, null, 2) + '\n' },
    { name: 'recent-log.txt', data: logs.join('\n') + (logs.length ? '\n' : '') }
  ]);
}

module.exports = { crc32, zip, redactText, createSupportBundle };
