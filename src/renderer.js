// ═══════════════════════════════════════════════════════
// SysGlance — Renderer Process
// ═══════════════════════════════════════════════════════

const { ipcRenderer } = require('electron');

// ── DOM References ─────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dom = {
  cpuLoad: $('cpu-load'), cpuBar: $('cpu-bar'), cpuModel: $('cpu-model'),
  cpuTemp: $('cpu-temp'), cpuSpeed: $('cpu-speed'), cpuCores: $('cpu-cores'),
  cpuPercore: $('cpu-percore'),
  memPct: $('mem-pct'), memBar: $('mem-bar'), memUsed: $('mem-used'), memSwap: $('mem-swap'),
  gpuLoad: $('gpu-load'), gpuName: $('gpu-name'), gpuInfo: $('gpu-info'), gpuBars: $('gpu-bars'),
  diskList: $('disk-list'),
  netIface: $('net-iface'), netRx: $('net-rx'), netTx: $('net-tx'),
  procList: $('proc-list'),
  batPct: $('bat-pct'), batBar: $('bat-bar'), batStatus: $('bat-status'), secBattery: $('sec-battery'),
  osDistro: $('os-distro'), osUptime: $('os-uptime'),
  btnLock: $('btn-lock'), btnCompact: $('btn-compact'), btnMinimize: $('btn-minimize'),
  opacitySlider: $('opacity-slider'),
};

// ── Utility ────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatBytesPerSec(bytes) {
  if (bytes < 1024) return bytes.toFixed(0) + ' B/s';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB/s';
  return (bytes / 1048576).toFixed(1) + ' MB/s';
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getLoadClass(pct) {
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return '';
}

function applyBarClass(bar, pct) {
  bar.className = 'progress-fill ' + getLoadClass(pct);
  bar.style.width = Math.min(pct, 100) + '%';
}

// ── Core Update ─────────────────────────────────────────
function updateUI(data) {
  if (data.error) {
    console.error('Data error:', data.error);
    return;
  }

  // CPU
  if (data.cpu) {
    const load = data.cpu.load;
    dom.cpuLoad.textContent = load.toFixed(1) + '%';
    applyBarClass(dom.cpuBar, load);

    dom.cpuModel.textContent = data.cpu.model;
    dom.cpuCores.textContent = data.cpu.cores + ' cores';
    dom.cpuSpeed.textContent = data.cpu.speed ? data.cpu.speed.toFixed(1) + ' GHz' : '— GHz';

    if (data.cpu.temp !== null && data.cpu.temp !== undefined) {
      const tempColor = data.cpu.temp >= 80 ? '⚠️' : '🌡️';
      dom.cpuTemp.textContent = tempColor + ' ' + data.cpu.temp.toFixed(0) + '°C';
      dom.cpuTemp.style.display = '';
    } else {
      dom.cpuTemp.style.display = 'none';
    }

    // Per-core bars
    if (data.cpu.perCore && data.cpu.perCore.length > 0) {
      let html = '';
      data.cpu.perCore.forEach((load, i) => {
        const cls = getLoadClass(load);
        html += `<div class="core-bar" title="Core ${i}: ${load.toFixed(1)}%"><div class="core-fill ${cls}" style="width:${Math.min(load, 100)}%"></div></div>`;
      });
      dom.cpuPercore.innerHTML = html;
    }
  }

  // Memory
  if (data.memory) {
    const pct = data.memory.percentage;
    dom.memPct.textContent = pct.toFixed(1) + '%';
    applyBarClass(dom.memBar, pct);
    dom.memUsed.textContent = formatBytes(data.memory.used) + ' / ' + formatBytes(data.memory.total);

    if (data.memory.swapTotal > 0) {
      dom.memSwap.textContent = 'Swap: ' + formatBytes(data.memory.swapUsed) + '/' + formatBytes(data.memory.swapTotal);
    } else {
      dom.memSwap.textContent = '';
    }
  }

  // GPU
  if (data.gpu && data.gpu.length > 0) {
    const gpu = data.gpu[0];
    dom.gpuName.textContent = gpu.name;
    let gpuLoad = '—';
    let gpuPct = 0;
    if (gpu.utilization !== null) {
      gpuPct = gpu.utilization;
      gpuLoad = gpu.utilization + '%';
    }
    dom.gpuLoad.textContent = gpuLoad;

    let barsHtml = '';
    if (gpu.utilization !== null) {
      barsHtml += `<div class="disk-item"><div class="disk-label"><span class="disk-fs">Utilization</span><span class="disk-pct">${gpu.utilization}%</span></div><div class="progress-bar"><div class="progress-fill ${getLoadClass(gpu.utilization)}" style="width:${Math.min(gpu.utilization, 100)}%"></div></div></div>`;
    }
    if (gpu.vram !== null && gpu.vramUsed !== null) {
      const vramPct = gpu.vram > 0 ? ((gpu.vramUsed / gpu.vram) * 100) : 0;
      barsHtml += `<div class="disk-item"><div class="disk-label"><span class="disk-fs">VRAM</span><span class="disk-pct">${formatBytes(gpu.vramUsed)} / ${formatBytes(gpu.vram)}</span></div><div class="progress-bar"><div class="progress-fill ${getLoadClass(vramPct)}" style="width:${Math.min(vramPct, 100)}%"></div></div></div>`;
    }
    if (gpu.temp !== null) {
      barsHtml += `<div class="info-row" style="margin-top:4px"><span class="info-small">🌡️ ${gpu.temp}°C</span></div>`;
    }
    dom.gpuBars.innerHTML = barsHtml;
  } else {
    dom.gpuLoad.textContent = 'N/A';
    dom.gpuName.textContent = 'No GPU detected';
  }

  // Disks
  if (data.disks && data.disks.length > 0) {
    let diskHtml = '';
    data.disks.forEach(d => {
      const usedStr = formatBytes(d.used);
      const sizeStr = formatBytes(d.size);
      diskHtml += `<div class="disk-item">
        <div class="disk-label">
          <span class="disk-fs">${d.fs}</span>
          <span class="disk-pct">${d.use}%</span>
        </div>
        <div class="disk-size">${usedStr} / ${sizeStr}</div>
        <div class="progress-bar"><div class="progress-fill ${getLoadClass(d.use)}" style="width:${Math.min(d.use, 100)}%"></div></div>
      </div>`;
    });
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
    let procHtml = `<div class="proc-row proc-header">
      <span>Process</span><span style="text-align:right">CPU</span><span style="text-align:right">MEM</span>
    </div>`;
    data.processes.forEach(p => {
      const cpuColor = p.cpu >= 10 ? 'var(--danger)' : p.cpu >= 5 ? 'var(--warning)' : 'var(--text-secondary)';
      procHtml += `<div class="proc-row">
        <span class="proc-name">${p.name}</span>
        <span class="proc-cpu" style="color:${cpuColor}">${p.cpu}%</span>
        <span class="proc-mem">${p.mem}%</span>
      </div>`;
    });
    dom.procList.innerHTML = procHtml;
  }

  // Battery
  if (data.battery) {
    dom.secBattery.style.display = '';
    dom.batPct.textContent = data.battery.percent + '%';
    applyBarClass(dom.batBar, data.battery.percent);
    const status = data.battery.charging ? '⚡ Charging' : data.battery.acConnected ? '🔌 AC' : '🔋 Battery';
    dom.batStatus.textContent = status;
  } else {
    dom.secBattery.style.display = 'none';
  }

  // OS
  if (data.os) {
    dom.osDistro.textContent = data.os.distro + ' ' + data.os.release;
    if (data.os.uptime) {
      dom.osUptime.textContent = '⏱ ' + formatUptime(data.os.uptime);
    }
  }
}

// ── IPC Events ──────────────────────────────────────────
ipcRenderer.on('system-data', (_event, data) => updateUI(data));

ipcRenderer.on('visibility-changed', (_event, visible) => {
  document.body.style.opacity = visible ? '1' : '0';
});

ipcRenderer.on('position-lock-changed', (_event, locked) => {
  document.body.classList.toggle('locked', locked);
  dom.btnLock.textContent = locked ? '🔒' : '🔓';
  if (!locked) document.body.classList.add('unlocked');
  else document.body.classList.remove('unlocked');
});

ipcRenderer.on('compact-mode-changed', (_event, compact) => {
  document.body.classList.toggle('compact', compact);
});

ipcRenderer.on('theme-changed', (_event, theme) => {
  document.body.setAttribute('data-theme', theme);
});

ipcRenderer.on('config-changed', (_event, config) => {
  // Re-apply config
  document.body.classList.toggle('compact', config.compactMode);
  document.body.setAttribute('data-theme', config.theme);
});

// ── Button Handlers ─────────────────────────────────────
dom.btnLock.addEventListener('click', () => ipcRenderer.send('toggle-position-lock'));
dom.btnCompact.addEventListener('click', () => ipcRenderer.send('toggle-compact'));
dom.btnMinimize.addEventListener('click', () => ipcRenderer.send('toggle-visibility'));

dom.opacitySlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value) / 100;
  ipcRenderer.send('set-opacity', val);
});

// ── Initial Request ─────────────────────────────────────
// Request initial data immediately
ipcRenderer.invoke('get-system-data').then(data => {
  updateUI(data);
}).catch(err => {
  console.error('Initial data fetch failed:', err);
});
