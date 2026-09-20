'use strict';

// Objective status only. This module does not infer that a machine is "slow"
// or sell an optimization. It reports the specific measurement that crossed a
// documented threshold and keeps the summary calm when everything is normal.

const GB = 1024 * 1024 * 1024;

function row(id, label, status, value, detail) {
  return { id, label, status, value: value == null ? null : value, detail: detail || '' };
}

function evaluateHealth(data) {
  const d = data || {};
  const rows = [];
  const cpu = d.cpu && Number(d.cpu.load);
  if (Number.isFinite(cpu)) rows.push(row('cpu', 'CPU', cpu >= 90 ? 'CRITICAL' : cpu >= 70 ? 'WARNING' : 'NORMAL', cpu, cpu.toFixed(1) + '% current load'));
  else rows.push(row('cpu', 'CPU', 'UNKNOWN', null, 'Waiting for a reading'));

  const memory = d.memory && Number(d.memory.percentage);
  if (Number.isFinite(memory)) rows.push(row('memory', 'RAM', memory >= 95 ? 'CRITICAL' : memory >= 90 ? 'WARNING' : 'NORMAL', memory, memory.toFixed(1) + '% used'));
  else rows.push(row('memory', 'RAM', 'UNKNOWN', null, 'Waiting for a reading'));

  const gpu = Array.isArray(d.gpu) ? d.gpu : [];
  const gpuTemp = gpu.reduce((max, item) => Math.max(max, Number(item && item.temp) || -Infinity), -Infinity);
  rows.push(Number.isFinite(gpuTemp)
    ? row('gpu', 'GPU', gpuTemp >= 95 ? 'CRITICAL' : gpuTemp >= 85 ? 'WARNING' : 'NORMAL', gpuTemp, gpuTemp.toFixed(0) + ' °C maximum')
    : row('gpu', 'GPU', 'UNKNOWN', null, 'Temperature unavailable'));

  const disk = (Array.isArray(d.disks) ? d.disks : []).filter((item) => Number.isFinite(item && item.available));
  const minFree = disk.length ? Math.min(...disk.map((item) => item.available)) : null;
  rows.push(minFree == null
    ? row('disk', 'Storage', 'UNKNOWN', null, 'Free space unavailable')
    : row('disk', 'Storage', minFree < 2 * GB ? 'CRITICAL' : minFree < 10 * GB ? 'WARNING' : 'NORMAL', minFree, (minFree / GB).toFixed(1) + ' GB free on the lowest volume'));

  const temp = d.cpu && Number(d.cpu.temp);
  if (Number.isFinite(temp)) rows.push(row('temperature', 'Temps', temp >= 95 ? 'CRITICAL' : temp >= 85 ? 'WARNING' : 'NORMAL', temp, temp.toFixed(0) + ' °C CPU temperature'));
  else rows.push(row('temperature', 'Temps', 'UNKNOWN', null, 'Temperature unavailable'));

  rows.push(row('network', 'Network', 'NORMAL', null, d.network && d.network.iface && d.network.iface !== '?' ? String(d.network.iface) : 'No active interface reported'));
  const order = { CRITICAL: 3, WARNING: 2, UNKNOWN: 1, NORMAL: 0 };
  const severe = rows.filter((item) => item.status === 'CRITICAL' || item.status === 'WARNING');
  const overall = rows.reduce((best, item) => order[item.status] > order[best] ? item.status : best, 'NORMAL');
  return {
    overall,
    rows,
    message: severe.length ? severe.length + ' measured item' + (severe.length === 1 ? '' : 's') + ' need attention' : 'No issues detected',
    generatedAt: Date.now()
  };
}

module.exports = { evaluateHealth, GB };
