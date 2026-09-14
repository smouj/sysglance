// ═══════════════════════════════════════════════════════
// SysGlance v1.2 — Renderer (settings panel, layout modes, rAF)
// ═══════════════════════════════════════════════════════

const { ipcRenderer } = require('electron');

// ── DOM Cache ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dom = {
  cpuLoad:$('cpu-load'),cpuBar:$('cpu-bar'),cpuModel:$('cpu-model'),cpuTemp:$('cpu-temp'),
  cpuSpeed:$('cpu-speed'),cpuCores:$('cpu-cores'),cpuPercore:$('cpu-percore'),
  memPct:$('mem-pct'),memBar:$('mem-bar'),memUsed:$('mem-used'),memSwap:$('mem-swap'),
  gpuLoad:$('gpu-load'),gpuName:$('gpu-name'),gpuBars:$('gpu-bars'),
  fsHome:$('fs-home'),fsFolders:$('fs-folders'),secFs:$('sec-filesystem'),
  diskList:$('disk-list'),
  netIface:$('net-iface'),netRx:$('net-rx'),netTx:$('net-tx'),
  procList:$('proc-list'),
  batPct:$('bat-pct'),batBar:$('bat-bar'),batStatus:$('bat-status'),secBattery:$('sec-battery'),
  osDistro:$('os-distro'),osUptime:$('os-uptime'),
  btnLock:$('btn-lock'),btnSettings:$('btn-settings'),btnMinimize:$('btn-minimize'),
  statusBar:$('status-bar'),statusClock:$('status-clock'),
  settingsPanel:$('settings-panel'),btnCloseSettings:$('btn-close-settings'),
  settingsOpacity:$('settings-opacity'),settingsRefresh:$('settings-refresh'),
  opacityVal:$('opacity-val'),refreshVal:$('refresh-val'),
  btnLockSettings:$('btn-lock-settings'),btnCompactSettings:$('btn-compact-settings'),
  layoutOptions:$('layout-options'),anchorOptions:$('anchor-options'),
  themeOptions:$('theme-options'),sectionToggles:$('section-toggles'),
};

// ── State ─────────────────────────────────────────────────
let positionLocked = true;
let currentConfig = {};

// ── Utilities ─────────────────────────────────────────────
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}
function fmtSpeed(b) {
  if (b < 1024) return b.toFixed(0) + ' B/s';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB/s';
  return (b / 1048576).toFixed(1) + ' MB/s';
}
function fmtUptime(s) {
  const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60);
  if(d>0)return d+'d '+h+'h'; if(h>0)return h+'h '+m+'m'; return m+'m';
}
function loadClass(p) { return p >= 90 ? 'danger' : p >= 70 ? 'warn' : ''; }

// ── Clock ──────────────────────────────────────────────────
function updateClock() {
  dom.statusClock.textContent = new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
}
setInterval(updateClock, 1000);
updateClock();

// ── Settings Panel ─────────────────────────────────────────
function toggleSettings(show) {
  if (show === undefined) show = dom.settingsPanel.classList.contains('hidden');
  dom.settingsPanel.classList.toggle('hidden', !show);
}

function updateSettingsUI(cfg) {
  // Layout buttons
  dom.layoutOptions.querySelectorAll('.settings-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === cfg.layout);
  });
  // Anchor buttons
  dom.anchorOptions.querySelectorAll('.settings-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.anchor === cfg.anchor);
  });
  // Theme buttons
  dom.themeOptions.querySelectorAll('.settings-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === cfg.theme);
  });
  // Sliders
  dom.settingsOpacity.value = Math.round(cfg.opacity * 100);
  dom.opacityVal.textContent = Math.round(cfg.opacity * 100) + '%';
  dom.settingsRefresh.value = cfg.refreshInterval || 1500;
  dom.refreshVal.textContent = ((cfg.refreshInterval || 1500) / 1000).toFixed(1) + 's';
  // Section toggles
  const sections = cfg.showSections || {};
  dom.sectionToggles.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    const sec = cb.dataset.section;
    cb.checked = sections[sec] !== false;
  });
  // Compact button
  dom.btnCompactSettings.textContent = cfg.compactMode ? '📐 Compact (On)' : '📐 Compact Mode';
  // Lock button
  dom.btnLockSettings.textContent = positionLocked ? '🔒 Unlock Position' : '🔓 Lock Position';
}

// Settings panel events
dom.btnSettings.addEventListener('click', () => toggleSettings());
dom.btnCloseSettings.addEventListener('click', () => toggleSettings(false));

// Layout buttons
dom.layoutOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings-opt');
  if (btn?.dataset.layout) ipcRenderer.send('set-layout', btn.dataset.layout);
});

// Anchor buttons
dom.anchorOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings-opt');
  if (btn?.dataset.anchor) ipcRenderer.send('set-anchor', btn.dataset.anchor);
});

// Theme buttons
dom.themeOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings-opt');
  if (btn?.dataset.theme) ipcRenderer.send('set-theme', btn.dataset.theme);
});

// Opacity slider
dom.settingsOpacity.addEventListener('input', (e) => {
  const val = parseInt(e.target.value) / 100;
  dom.opacityVal.textContent = e.target.value + '%';
  ipcRenderer.send('set-opacity', val);
});

// Refresh rate slider
dom.settingsRefresh.addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  dom.refreshVal.textContent = (val / 1000).toFixed(1) + 's';
  ipcRenderer.send('set-config', 'refreshInterval', val);
});

// Section toggles
dom.sectionToggles.addEventListener('change', (e) => {
  const cb = e.target;
  if (cb.dataset.section) {
    const sections = { ...(currentConfig.showSections || {}) };
    sections[cb.dataset.section] = cb.checked;
    ipcRenderer.send('set-config', 'showSections', sections);
    // Show/hide section immediately
    const sec = document.getElementById('sec-' + cb.dataset.section);
    if (sec) sec.classList.toggle('hidden-section', !cb.checked);
  }
});

// Lock & compact buttons in settings
dom.btnLockSettings.addEventListener('click', () => ipcRenderer.send('toggle-position-lock'));
dom.btnCompactSettings.addEventListener('click', () => ipcRenderer.send('toggle-compact'));

// Status bar buttons
dom.btnLock.addEventListener('click', () => ipcRenderer.send('toggle-position-lock'));
dom.btnMinimize.addEventListener('click', () => ipcRenderer.send('toggle-visibility'));

// ── Core Update (rAF batched) ──────────────────────────────
let pendingData = null, rafScheduled = false;

function scheduleUpdate(data) {
  pendingData = data;
  if (!rafScheduled) { rafScheduled = true; requestAnimationFrame(applyUpdate); }
}

function applyUpdate() {
  rafScheduled = false;
  const data = pendingData;
  if (!data || data.error) return;

  // Layout mode
  if (data.layout) document.body.setAttribute('data-layout', data.layout);

  // CPU
  if (data.cpu) {
    const load = data.cpu.load;
    dom.cpuLoad.textContent = load.toFixed(1) + '%';
    dom.cpuBar.className = 'progress-fill ' + loadClass(load);
    dom.cpuBar.style.width = Math.min(load, 100) + '%';
    dom.cpuModel.textContent = data.cpu.model;
    dom.cpuCores.textContent = data.cpu.cores + ' cores';
    if (data.cpu.temp != null) {
      const icon = data.cpu.temp >= 80 ? '🔥' : '🌡️';
      dom.cpuTemp.textContent = icon + ' ' + data.cpu.temp.toFixed(0) + '°C';
      dom.cpuTemp.style.display = '';
      dom.cpuTemp.className = 'info-badge' + (data.cpu.temp >= 80 ? ' danger' : data.cpu.temp >= 65 ? ' warn' : '');
    } else dom.cpuTemp.style.display = 'none';
    if (data.cpu.perCore?.length) {
      let html = '';
      for (let i = 0; i < data.cpu.perCore.length; i++) {
        html += '<div class="core-bar" title="Core '+i+'"><div class="core-fill '+loadClass(data.cpu.perCore[i])+'" style="width:'+Math.min(data.cpu.perCore[i],100)+'%"></div></div>';
      }
      dom.cpuPercore.innerHTML = html;
    }
  }

  // Memory
  if (data.memory) {
    const pct = data.memory.percentage;
    dom.memPct.textContent = pct.toFixed(1) + '%';
    dom.memBar.className = 'progress-fill ' + loadClass(pct);
    dom.memBar.style.width = Math.min(pct, 100) + '%';
    dom.memUsed.textContent = fmtBytes(data.memory.used) + ' / ' + fmtBytes(data.memory.total);
    dom.memSwap.textContent = data.memory.swapTotal > 0 ? 'Swap: ' + fmtBytes(data.memory.swapUsed) + '/' + fmtBytes(data.memory.swapTotal) : '';
  }

  // GPU
  if (data.gpu?.length > 0) {
    const gpu = data.gpu[0];
    dom.gpuName.textContent = gpu.name;
    dom.gpuLoad.textContent = gpu.utilization != null ? gpu.utilization + '%' : '—';
    let barsHtml = '';
    if (gpu.utilization != null) barsHtml += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">GPU Load</span><span class="disk-pct">'+gpu.utilization+'%</span></div><div class="progress-bar"><div class="progress-fill '+loadClass(gpu.utilization)+'" style="width:'+Math.min(gpu.utilization,100)+'%"></div></div></div>';
    if (gpu.vram != null && gpu.vramUsed != null) { const vr = gpu.vram > 0 ? ((gpu.vramUsed/gpu.vram)*100):0; barsHtml += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">VRAM</span><span class="disk-pct">'+fmtBytes(gpu.vramUsed)+' / '+fmtBytes(gpu.vram)+'</span></div><div class="progress-bar"><div class="progress-fill '+loadClass(vr)+'" style="width:'+Math.min(vr,100)+'%"></div></div></div>'; }
    if (gpu.temp != null) barsHtml += '<div class="info-row" style="margin-top:3px"><span class="info-small">🌡️ '+gpu.temp+'°C</span></div>';
    dom.gpuBars.innerHTML = barsHtml;
  } else { dom.gpuLoad.textContent = 'N/A'; dom.gpuName.textContent = 'No GPU'; }

  // Filesystem
  if (data.filesystem?.folders?.length) {
    dom.fsHome.textContent = data.filesystem.home.replace(/^\/home\/[^/]+/, '~');
    let html = '';
    for (const f of data.filesystem.folders) {
      html += '<div class="fs-item" data-path="'+f.path+'" title="'+f.path+' ('+f.count+' items)"><span class="fs-item-icon">'+f.icon+'</span><div class="fs-item-info"><div class="fs-item-name">'+f.name+'</div><div class="fs-item-count">'+f.count+' items</div></div></div>';
    }
    dom.fsFolders.innerHTML = html;
    dom.secFs.classList.remove('hidden-section');
    dom.fsFolders.querySelectorAll('.fs-item').forEach(el => {
      el.addEventListener('click', () => ipcRenderer.send('open-folder', el.dataset.path));
    });
  } else dom.secFs.classList.add('hidden-section');

  // Disks
  if (data.disks?.length) {
    let html = '';
    for (const d of data.disks) html += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">'+(d.mount||d.fs)+'</span><span class="disk-pct">'+d.use+'%</span></div><div class="disk-size">'+fmtBytes(d.used)+' / '+fmtBytes(d.size)+'</div><div class="progress-bar"><div class="progress-fill '+loadClass(d.use)+'" style="width:'+Math.min(d.use,100)+'%"></div></div></div>';
    dom.diskList.innerHTML = html;
  }

  // Network
  if (data.network) { dom.netIface.textContent = data.network.iface; dom.netRx.textContent = fmtSpeed(data.network.rx_sec); dom.netTx.textContent = fmtSpeed(data.network.tx_sec); }

  // Processes
  if (data.processes?.length) {
    let html = '<div class="proc-row proc-header"><span>Process</span><span style="text-align:right">CPU</span><span style="text-align:right">MEM</span></div>';
    for (const p of data.processes) {
      const cc = p.cpu >= 10 ? 'var(--danger)' : p.cpu >= 5 ? 'var(--warning)' : 'var(--text-muted)';
      html += '<div class="proc-row"><span class="proc-name">'+p.name+'</span><span class="proc-cpu" style="color:'+cc+'">'+p.cpu+'%</span><span class="proc-mem">'+p.mem+'%</span></div>';
    }
    dom.procList.innerHTML = html;
  }

  // Battery
  if (data.battery) {
    dom.secBattery.style.display = '';
    dom.batPct.textContent = data.battery.percent + '%';
    dom.batBar.className = 'progress-fill ' + loadClass(100 - data.battery.percent);
    dom.batBar.style.width = data.battery.percent + '%';
    dom.batStatus.textContent = data.battery.charging ? '⚡ Charging' : data.battery.acConnected ? '🔌 AC' : '🔋 Battery';
  } else dom.secBattery.style.display = 'none';

  // OS
  if (data.os) {
    dom.osDistro.textContent = data.os.distro + ' ' + data.os.release;
    if (data.os.uptime) dom.osUptime.textContent = '⏱ ' + fmtUptime(data.os.uptime);
  }
}

// ── IPC Events ──────────────────────────────────────────────
ipcRenderer.on('system-data', (_e, data) => scheduleUpdate(data));
ipcRenderer.on('visibility-changed', (_e, v) => { document.body.style.opacity = v ? '1' : '0'; });
ipcRenderer.on('position-lock-changed', (_e, locked) => {
  positionLocked = locked;
  dom.btnLock.textContent = locked ? '🔒' : '🔓';
  document.body.classList.toggle('locked', locked);
  document.body.classList.toggle('unlocked', !locked);
  updateSettingsUI(currentConfig);
});
ipcRenderer.on('compact-mode-changed', (_e, compact) => { document.body.classList.toggle('compact', compact); currentConfig.compactMode = compact; updateSettingsUI(currentConfig); });
ipcRenderer.on('theme-changed', (_e, theme) => { document.body.setAttribute('data-theme', theme); currentConfig.theme = theme; updateSettingsUI(currentConfig); });
ipcRenderer.on('layout-changed', (_e, layout) => { document.body.setAttribute('data-layout', layout); currentConfig.layout = layout; updateSettingsUI(currentConfig); });
ipcRenderer.on('config-changed', (_e, cfg) => {
  currentConfig = cfg;
  document.body.classList.toggle('compact', cfg.compactMode);
  document.body.setAttribute('data-theme', cfg.theme);
  document.body.setAttribute('data-layout', cfg.layout || 'sidebar');
  if (cfg.showSections) {
    for (const [sec, show] of Object.entries(cfg.showSections)) {
      const el = document.getElementById('sec-' + sec);
      if (el) el.classList.toggle('hidden-section', !show);
    }
  }
  updateSettingsUI(cfg);
});
ipcRenderer.on('toggle-settings', () => toggleSettings());

// ── Initial ────────────────────────────────────────────────
ipcRenderer.invoke('get-system-data').then(data => {
  if (data.config) { currentConfig = data.config; updateSettingsUI(data.config); }
  scheduleUpdate(data);
}).catch(() => {});
