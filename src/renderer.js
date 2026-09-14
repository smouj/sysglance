// ═══════════════════════════════════════════════════════
// SysGlance — Renderer (optimized: DOM cache, rAF, filesystem)
// ═══════════════════════════════════════════════════════

const { ipcRenderer } = require('electron');

// ── DOM Cache (avoid repeated getElementById calls) ─────
const $ = (id) => document.getElementById(id);
const dom = {
  cpuLoad: $('cpu-load'), cpuBar: $('cpu-bar'), cpuModel: $('cpu-model'),
  cpuTemp: $('cpu-temp'), cpuSpeed: $('cpu-speed'), cpuCores: $('cpu-cores'),
  cpuPercore: $('cpu-percore'),
  memPct: $('mem-pct'), memBar: $('mem-bar'), memUsed: $('mem-used'), memSwap: $('mem-swap'),
  gpuLoad: $('gpu-load'), gpuName: $('gpu-name'), gpuBars: $('gpu-bars'),
  fsHome: $('fs-home'), fsFolders: $('fs-folders'),
  diskList: $('disk-list'),
  netIface: $('net-iface'), netRx: $('net-rx'), netTx: $('net-tx'),
  procList: $('proc-list'),
  batPct: $('bat-pct'), batBar: $('bat-bar'), batStatus: $('bat-status'), secBattery: $('sec-battery'),
  osDistro: $('os-distro'), osUptime: $('os-uptime'),
  secFs: $('sec-filesystem'),
  btnLock: $('btn-lock'), btnCompact: $('btn-compact'), btnMinimize: $('btn-minimize'),
  opacitySlider: $('opacity-slider'), statusBar: $('status-bar'),
  statusClock: $('status-clock'),
};

// ── Utilities ──────────────────────────────────────────
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

function formatBytesPerSec(b) {
  if (b < 1024) return b.toFixed(0) + ' B/s';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB/s';
  return (b / 1048576).toFixed(1) + ' MB/s';
}

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getLoadClass(pct) { return pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : ''; }

// ── Clock ───────────────────────────────────────────────
function updateClock() {
  dom.statusClock.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ── Core Update (batched via rAF for performance) ────────
let pendingData = null;
let rafScheduled = false;

function scheduleUpdate(data) {
  pendingData = data;
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(applyUpdate);
  }
}

function applyUpdate() {
  rafScheduled = false;
  const data = pendingData;
  if (!data || data.error) return;

  // CPU
  if (data.cpu) {
    const load = data.cpu.load;
    dom.cpuLoad.textContent = load.toFixed(1) + '%';
    dom.cpuBar.className = 'progress-fill ' + getLoadClass(load);
    dom.cpuBar.style.width = Math.min(load, 100) + '%';
    dom.cpuModel.textContent = data.cpu.model;
    dom.cpuCores.textContent = data.cpu.cores + ' cores';

    if (data.cpu.temp != null) {
      const icon = data.cpu.temp >= 80 ? '🔥' : '🌡️';
      dom.cpuTemp.textContent = icon + ' ' + data.cpu.temp.toFixed(0) + '°C';
      dom.cpuTemp.style.display = '';
      dom.cpuTemp.className = 'info-badge' + (data.cpu.temp >= 80 ? ' danger' : data.cpu.temp >= 65 ? ' warn' : '');
    } else {
      dom.cpuTemp.style.display = 'none';
    }

    if (data.cpu.perCore && data.cpu.perCore.length > 0) {
      let html = '';
      for (let i = 0; i < data.cpu.perCore.length; i++) {
        const l = data.cpu.perCore[i];
        html += '<div class="core-bar" title="Core ' + i + ': ' + l.toFixed(1) + '%"><div class="core-fill ' + getLoadClass(l) + '" style="width:' + Math.min(l, 100) + '%"></div></div>';
      }
      dom.cpuPercore.innerHTML = html;
    }
  }

  // Memory
  if (data.memory) {
    const pct = data.memory.percentage;
    dom.memPct.textContent = pct.toFixed(1) + '%';
    dom.memBar.className = 'progress-fill ' + getLoadClass(pct);
    dom.memBar.style.width = Math.min(pct, 100) + '%';
    dom.memUsed.textContent = formatBytes(data.memory.used) + ' / ' + formatBytes(data.memory.total);
    dom.memSwap.textContent = data.memory.swapTotal > 0 ? 'Swap: ' + formatBytes(data.memory.swapUsed) + '/' + formatBytes(data.memory.swapTotal) : '';
  }

  // GPU
  if (data.gpu && data.gpu.length > 0) {
    const gpu = data.gpu[0];
    dom.gpuName.textContent = gpu.name;
    dom.gpuLoad.textContent = gpu.utilization != null ? gpu.utilization + '%' : '—';

    let barsHtml = '';
    if (gpu.utilization != null) {
      barsHtml += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">Utilization</span><span class="disk-pct">' + gpu.utilization + '%</span></div><div class="progress-bar"><div class="progress-fill ' + getLoadClass(gpu.utilization) + '" style="width:' + Math.min(gpu.utilization, 100) + '%"></div></div></div>';
    }
    if (gpu.vram != null && gpu.vramUsed != null) {
      const vramPct = gpu.vram > 0 ? ((gpu.vramUsed / gpu.vram) * 100) : 0;
      barsHtml += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">VRAM</span><span class="disk-pct">' + formatBytes(gpu.vramUsed) + ' / ' + formatBytes(gpu.vram) + '</span></div><div class="progress-bar"><div class="progress-fill ' + getLoadClass(vramPct) + '" style="width:' + Math.min(vramPct, 100) + '%"></div></div></div>';
    }
    if (gpu.temp != null) {
      barsHtml += '<div class="info-row" style="margin-top:3px"><span class="info-small">🌡️ ' + gpu.temp + '°C</span></div>';
    }
    dom.gpuBars.innerHTML = barsHtml;
  } else {
    dom.gpuLoad.textContent = 'N/A';
    dom.gpuName.textContent = 'No GPU';
  }

  // Filesystem (folders)
  if (data.filesystem && data.filesystem.folders && data.filesystem.folders.length > 0) {
    dom.fsHome.textContent = data.filesystem.home.replace(/^\/home\/[^/]+/, '~');
    let fsHtml = '';
    for (const f of data.filesystem.folders) {
      fsHtml += '<div class="fs-item" data-path="' + f.path + '" title="' + f.path + ' (' + f.count + ' items)">' +
        '<span class="fs-item-icon">' + f.icon + '</span>' +
        '<div class="fs-item-info"><div class="fs-item-name">' + f.name + '</div>' +
        '<div class="fs-item-count">' + f.count + ' items</div></div></div>';
    }
    dom.fsFolders.innerHTML = fsHtml;
    dom.secFs.style.display = '';

    // Click handlers for folders
    const items = dom.fsFolders.querySelectorAll('.fs-item');
    for (const item of items) {
      item.addEventListener('click', () => {
        ipcRenderer.send('open-folder', item.dataset.path);
      });
    }
  } else {
    dom.secFs.style.display = 'none';
  }

  // Disks
  if (data.disks && data.disks.length > 0) {
    let diskHtml = '';
    for (const d of data.disks) {
      diskHtml += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">' + (d.mount || d.fs) + '</span><span class="disk-pct">' + d.use + '%</span></div>' +
        '<div class="disk-size">' + formatBytes(d.used) + ' / ' + formatBytes(d.size) + '</div>' +
        '<div class="progress-bar"><div class="progress-fill ' + getLoadClass(d.use) + '" style="width:' + Math.min(d.use, 100) + '%"></div></div></div>';
    }
    dom.diskList.innerHTML = diskHtml;
  }

  // Network
  if (data.network) {
    dom.netIface.textContent = data.network.iface;
    dom.netRx.textContent = formatBytesPerSec(data.network.rx_sec);
    dom.netTx.textContent = formatBytesPerSec(data.network.tx_sec);
  }

  // Processes
  if (data.processes && data.processes.length > 0) {
    let procHtml = '<div class="proc-row proc-header"><span>Process</span><span style="text-align:right">CPU</span><span style="text-align:right">MEM</span></div>';
    for (const p of data.processes) {
      const cpuColor = p.cpu >= 10 ? 'var(--danger)' : p.cpu >= 5 ? 'var(--warning)' : 'var(--text-muted)';
      procHtml += '<div class="proc-row"><span class="proc-name">' + p.name + '</span><span class="proc-cpu" style="color:' + cpuColor + '">' + p.cpu + '%</span><span class="proc-mem">' + p.mem + '%</span></div>';
    }
    dom.procList.innerHTML = procHtml;
  }

  // Battery
  if (data.battery) {
    dom.secBattery.style.display = '';
    dom.batPct.textContent = data.battery.percent + '%';
    dom.batBar.className = 'progress-fill ' + getLoadClass(100 - data.battery.percent);
    dom.batBar.style.width = data.battery.percent + '%';
    dom.batStatus.textContent = data.battery.charging ? '⚡ Charging' : data.battery.acConnected ? '🔌 AC' : '🔋 Battery';
  } else {
    dom.secBattery.style.display = 'none';
  }

  // OS
  if (data.os) {
    dom.osDistro.textContent = data.os.distro + ' ' + data.os.release;
    if (data.os.uptime) dom.osUptime.textContent = '⏱ ' + formatUptime(data.os.uptime);
  }
}

// ── IPC Events ──────────────────────────────────────────
ipcRenderer.on('system-data', (_e, data) => scheduleUpdate(data));
ipcRenderer.on('visibility-changed', (_e, visible) => { document.body.style.opacity = visible ? '1' : '0'; });
ipcRenderer.on('position-lock-changed', (_e, locked) => {
  positionLocked = locked;
  dom.btnLock.textContent = locked ? '🔒' : '🔓';
  document.body.classList.toggle('locked', locked);
  document.body.classList.toggle('unlocked', !locked);
});
ipcRenderer.on('compact-mode-changed', (_e, compact) => { document.body.classList.toggle('compact', compact); });
ipcRenderer.on('theme-changed', (_e, theme) => { document.body.setAttribute('data-theme', theme); });
ipcRenderer.on('config-changed', (_e, cfg) => {
  document.body.classList.toggle('compact', cfg.compactMode);
  document.body.setAttribute('data-theme', cfg.theme);
  dom.secFs.style.display = cfg.showFilesystem ? '' : 'none';
});

// ── Button Handlers ──────────────────────────────────────
let positionLocked = true;
dom.btnLock.addEventListener('click', () => ipcRenderer.send('toggle-position-lock'));
dom.btnCompact.addEventListener('click', () => ipcRenderer.send('toggle-compact'));
dom.btnMinimize.addEventListener('click', () => ipcRenderer.send('toggle-visibility'));
dom.opacitySlider.addEventListener('input', (e) => {
  ipcRenderer.send('set-opacity', parseInt(e.target.value) / 100);
});

// ── Initial Data ─────────────────────────────────────────
ipcRenderer.invoke('get-system-data').then(data => scheduleUpdate(data)).catch(() => {});
