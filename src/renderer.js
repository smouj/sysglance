// ═══════════════════════════════════════════════════════
// SysGlance — renderer
//
// Runs sandboxed with contextIsolation: the only contact with the system is
// `window.sysglance` (see src/preload.js). No Node, no ipcRenderer, no
// filesystem access from here.
//
// Updates are batched in requestAnimationFrame; the fast metrics tier arrives
// every ~1.5 s (in-process, `os` module) and the hardware tier every 5–10 s.
// ═══════════════════════════════════════════════════════

(function () {
  'use strict';

  var api = window.sysglance;
  if (!api) {
    document.body.innerHTML = '<div style="padding:12px;font:12px monospace;color:#ff6b6b">' +
      'SysGlance preload bridge unavailable — run through Electron (npm start).</div>';
    return;
  }

  // ── DOM cache ──────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var dom = {
    cpuLoad: $('cpu-load'), cpuBar: $('cpu-bar'), cpuModel: $('cpu-model'), cpuTemp: $('cpu-temp'),
    cpuSpeed: $('cpu-speed'), cpuCores: $('cpu-cores'), cpuPercore: $('cpu-percore'),
    memPct: $('mem-pct'), memBar: $('mem-bar'), memUsed: $('mem-used'), memSwap: $('mem-swap'),
    gpuLoad: $('gpu-load'), gpuName: $('gpu-name'), gpuBars: $('gpu-bars'),
    fsHome: $('fs-home'), fsFolders: $('fs-folders'), secFs: $('sec-filesystem'),
    secGpu: $('sec-gpu'),
    diskList: $('disk-list'),
    netIface: $('net-iface'), netRx: $('net-rx'), netTx: $('net-tx'),
    procList: $('proc-list'),
    batPct: $('bat-pct'), batBar: $('bat-bar'), batStatus: $('bat-status'), secBattery: $('sec-battery'),
    osDistro: $('os-distro'), osUptime: $('os-uptime'),
    btnLock: $('btn-lock'), btnSettings: $('btn-settings'), btnMinimize: $('btn-minimize'),
    statusClock: $('status-clock'), perfReadout: $('perf-readout'), appVersion: $('app-version'),
    suiteVersion: $('suite-version'),
    settingsPanel: $('settings-panel'), btnCloseSettings: $('btn-close-settings'),
    settingsOpacity: $('settings-opacity'), settingsRefresh: $('settings-refresh'), settingsSlow: $('settings-slow'),
    opacityVal: $('opacity-val'), refreshVal: $('refresh-val'), slowVal: $('slow-val'),
    btnLockSettings: $('btn-lock-settings'), btnCompactSettings: $('btn-compact-settings'),
    layoutOptions: $('layout-options'), anchorOptions: $('anchor-options'),
    themeOptions: $('theme-options'), sectionToggles: $('section-toggles'),
    appInfo: $('app-info'), metricInfo: $('metric-info')
  };

  // ── state ─────────────────────────────────────────────
  var positionLocked = true;
  var currentConfig = {};

  var SECTION_IDS = ['cpu', 'memory', 'gpu', 'filesystem', 'disks', 'network', 'processes', 'battery'];

  // ── formatting ────────────────────────────────────────
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
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }
  function loadClass(p) { return p >= 90 ? 'danger' : p >= 70 ? 'warn' : ''; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Sliders paint their filled track from --fill, so the control reads at a
  // glance instead of being a bare line with a floating knob.
  function setSliderFill(input) {
    if (!input) return;
    var min = Number(input.min) || 0, max = Number(input.max) || 100, v = Number(input.value) || 0;
    var pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', Math.max(0, Math.min(100, pct)).toFixed(1) + '%');
  }
  var FOLDER_ICON = '<svg class="ic" viewBox="0 0 24 24"><use href="#i-files"/></svg>';

  // ── clock ─────────────────────────────────────────────
  function updateClock() {
    dom.statusClock.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── settings panel ────────────────────────────────────
  function toggleSettings(show) {
    if (show === undefined) show = dom.settingsPanel.classList.contains('hidden');
    dom.settingsPanel.classList.toggle('hidden', !show);
  }

  function updateSettingsUI(cfg) {
    dom.layoutOptions.querySelectorAll('.settings-opt').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.layout === cfg.layout);
    });
    dom.anchorOptions.querySelectorAll('.settings-opt').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.anchor === cfg.anchor);
    });
    dom.themeOptions.querySelectorAll('.settings-opt').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.theme === cfg.theme);
    });
    dom.settingsOpacity.value = Math.round((cfg.opacity || 0.9) * 100);
    dom.opacityVal.textContent = Math.round((cfg.opacity || 0.9) * 100) + '%';
    dom.settingsRefresh.value = cfg.refreshInterval || 1500;
    dom.refreshVal.textContent = ((cfg.refreshInterval || 1500) / 1000).toFixed(1) + 's';
    dom.settingsSlow.value = cfg.slowInterval || 7000;
    dom.slowVal.textContent = ((cfg.slowInterval || 7000) / 1000).toFixed(1) + 's';
    setSliderFill(dom.settingsOpacity);
    setSliderFill(dom.settingsRefresh);
    setSliderFill(dom.settingsSlow);
    var sections = cfg.showSections || {};
    dom.sectionToggles.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.checked = sections[cb.dataset.section] !== false;
    });
    dom.btnCompactSettings.textContent = cfg.compactMode ? 'Compact: on' : 'Compact mode';
    dom.btnLockSettings.textContent = positionLocked ? 'Unlock position' : 'Lock position';
  }

  function applySectionVisibility(cfg) {
    var sections = cfg.showSections || {};
    SECTION_IDS.forEach(function (sec) {
      var el = $('sec-' + sec);
      if (!el) return;
      var on = sections[sec] !== false;
      if (sec === 'filesystem') on = on && cfg.showFilesystem !== false;
      el.classList.toggle('hidden-section', !on);
    });
    // Shell controls only exist on hosts with a Windows registry (see panel.js).
    var shell = $('sec-shell');
    if (shell && shell.dataset.supported === 'false') shell.classList.add('hidden-section');
  }

  // ── settings events ───────────────────────────────────
  dom.btnSettings.addEventListener('click', function () { toggleSettings(); });
  dom.btnCloseSettings.addEventListener('click', function () { toggleSettings(false); });

  dom.layoutOptions.addEventListener('click', function (e) {
    var btn = e.target.closest('.settings-opt');
    if (btn && btn.dataset.layout) api.setConfig('layout', btn.dataset.layout);
  });
  dom.anchorOptions.addEventListener('click', function (e) {
    var btn = e.target.closest('.settings-opt');
    if (btn && btn.dataset.anchor) api.setConfig('anchor', btn.dataset.anchor);
  });
  dom.themeOptions.addEventListener('click', function (e) {
    var btn = e.target.closest('.settings-opt');
    if (btn && btn.dataset.theme) api.setConfig('theme', btn.dataset.theme);
  });
  dom.settingsOpacity.addEventListener('input', function (e) {
    setSliderFill(e.target);
    dom.opacityVal.textContent = e.target.value + '%';
    api.setOpacity(parseInt(e.target.value, 10) / 100);
  });
  dom.settingsRefresh.addEventListener('input', function (e) {
    setSliderFill(e.target);
    var val = parseInt(e.target.value, 10);
    dom.refreshVal.textContent = (val / 1000).toFixed(1) + 's';
    api.setConfig('refreshInterval', val);
  });
  dom.settingsSlow.addEventListener('input', function (e) {
    setSliderFill(e.target);
    var val = parseInt(e.target.value, 10);
    dom.slowVal.textContent = (val / 1000).toFixed(1) + 's';
    api.setConfig('slowInterval', val);
  });
  dom.sectionToggles.addEventListener('change', function (e) {
    var cb = e.target;
    if (!cb.dataset.section) return;
    var sections = Object.assign({}, currentConfig.showSections || {});
    sections[cb.dataset.section] = cb.checked;
    currentConfig.showSections = sections;
    api.setConfig('showSections', sections);
    var sec = $('sec-' + cb.dataset.section);
    if (sec) sec.classList.toggle('hidden-section', !cb.checked);
  });
  dom.btnLockSettings.addEventListener('click', function () { api.togglePositionLock(); });
  dom.btnCompactSettings.addEventListener('click', function () { api.toggleCompact(); });
  dom.btnLock.addEventListener('click', function () { api.togglePositionLock(); });
  dom.btnMinimize.addEventListener('click', function () { api.toggleVisibility(); });

  // ── rAF-batched rendering ─────────────────────────────
  var pendingData = null, rafScheduled = false;

  function scheduleUpdate(data) {
    pendingData = data;
    if (!rafScheduled) { rafScheduled = true; requestAnimationFrame(applyUpdate); }
  }

  function applyUpdate() {
    rafScheduled = false;
    var data = pendingData;
    if (!data || data.error) return;

    if (data.layout) document.body.setAttribute('data-layout', data.layout);

    // CPU
    if (data.cpu) {
      var load = data.cpu.load || 0;
      dom.cpuLoad.textContent = load.toFixed(1) + '%';
      dom.cpuBar.className = 'progress-fill ' + loadClass(load);
      dom.cpuBar.style.width = Math.min(load, 100) + '%';
      dom.cpuModel.textContent = data.cpu.model;
      dom.cpuCores.textContent = data.cpu.cores + ' cores';
      dom.cpuSpeed.textContent = data.cpu.speed ? (data.cpu.speed / 1000).toFixed(2) + ' GHz' : '';
      if (data.cpu.temp != null) {
        var hot = data.cpu.temp >= 80;
        dom.cpuTemp.textContent = data.cpu.temp.toFixed(0) + '\u00b0C';
        dom.cpuTemp.style.display = '';
        dom.cpuTemp.className = 'info-badge' + (hot ? ' danger' : data.cpu.temp >= 65 ? ' warn' : '');
      } else dom.cpuTemp.style.display = 'none';
      if (data.cpu.perCore && data.cpu.perCore.length) {
        var html = '';
        for (var i = 0; i < data.cpu.perCore.length; i++) {
          var coreVal = Math.max(2, Math.min(data.cpu.perCore[i], 100));
          html += '<div class="core-bar" title="Core ' + i + ' \u2014 ' + data.cpu.perCore[i] + '%"><div class="core-fill ' +
            loadClass(data.cpu.perCore[i]) + '" style="height:' + coreVal + '%"></div></div>';
        }
        dom.cpuPercore.innerHTML = html;
      }
    }

    // Memory
    if (data.memory) {
      var pct = data.memory.percentage || 0;
      dom.memPct.textContent = pct.toFixed(1) + '%';
      dom.memBar.className = 'progress-fill ' + loadClass(pct);
      dom.memBar.style.width = Math.min(pct, 100) + '%';
      dom.memUsed.textContent = fmtBytes(data.memory.used) + ' / ' + fmtBytes(data.memory.total);
      dom.memSwap.textContent = data.memory.swapTotal > 0
        ? 'Swap: ' + fmtBytes(data.memory.swapUsed) + '/' + fmtBytes(data.memory.swapTotal) : '';
    }

    // GPU
    if (data.gpu && data.gpu.length > 0) {
      var gpu = data.gpu[0];
      dom.gpuName.textContent = gpu.name;
      dom.gpuLoad.textContent = gpu.utilization != null ? gpu.utilization + '%' : '—';
      var bars = '';
      if (gpu.utilization != null) {
        bars += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">GPU Load</span><span class="disk-pct">' + gpu.utilization +
          '%</span></div><div class="progress-bar"><div class="progress-fill ' + loadClass(gpu.utilization) + '" style="width:' + Math.min(gpu.utilization, 100) + '%"></div></div></div>';
      }
      if (gpu.vram != null && gpu.vramUsed != null) {
        var vr = gpu.vram > 0 ? ((gpu.vramUsed / gpu.vram) * 100) : 0;
        bars += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">VRAM</span><span class="disk-pct">' + fmtBytes(gpu.vramUsed) + ' / ' + fmtBytes(gpu.vram) +
          '</span></div><div class="progress-bar"><div class="progress-fill ' + loadClass(vr) + '" style="width:' + Math.min(vr, 100) + '%"></div></div></div>';
      }
      if (gpu.temp != null) bars += '<div class="info-row info-row-secondary"><span class="info-small">' + gpu.temp + ' \u00b0C</span></div>';
      dom.gpuBars.innerHTML = bars;
      dom.secGpu.classList.remove('is-empty');
    } else {
      dom.gpuLoad.textContent = '';
      dom.gpuName.textContent = 'No GPU reported on this system';
      dom.gpuName.classList.add('is-empty');
      dom.gpuBars.innerHTML = '';
      dom.secGpu.classList.add('is-empty');
    }

    // Filesystem folders
    if (data.filesystem && data.filesystem.folders && data.filesystem.folders.length) {
      dom.fsHome.textContent = data.filesystem.home.replace(/^\/home\/[^/]+/, '~');
      var fhtml = '';
      for (var f = 0; f < data.filesystem.folders.length; f++) {
        var folder = data.filesystem.folders[f];
        fhtml += '<div class="fs-item" data-path="' + esc(folder.path) + '" title="' + esc(folder.path) + ' (' + folder.count + ' items)">' +
          '<span class="fs-item-icon">' + FOLDER_ICON + '</span><div class="fs-item-info">' +
          '<div class="fs-item-name">' + esc(folder.name) + '</div>' +
          '<div class="fs-item-count">' + folder.count + ' items</div></div></div>';
      }
      dom.fsFolders.innerHTML = fhtml;
      dom.fsFolders.querySelectorAll('.fs-item').forEach(function (el) {
        el.addEventListener('click', function () { api.openFolder(el.dataset.path); });
      });
    }

    // Disks
    if (data.disks && data.disks.length) {
      var dhtml = '';
      for (var d = 0; d < data.disks.length; d++) {
        var disk = data.disks[d];
        dhtml += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">' + esc(disk.mount || disk.fs) +
          '</span><span class="disk-pct">' + disk.use + '%</span></div><div class="disk-size">' + fmtBytes(disk.used) + ' / ' + fmtBytes(disk.size) +
          '</div><div class="progress-bar"><div class="progress-fill ' + loadClass(disk.use) + '" style="width:' + Math.min(disk.use, 100) + '%"></div></div></div>';
      }
      dom.diskList.innerHTML = dhtml;
    }

    // Network
    if (data.network) {
      dom.netIface.textContent = data.network.iface;
      dom.netRx.textContent = fmtSpeed(data.network.rx_sec);
      dom.netTx.textContent = fmtSpeed(data.network.tx_sec);
    }

    // Processes
    if (data.processes && data.processes.length) {
      var phtml = '<div class="proc-row proc-header"><span>Process</span><span style="text-align:right">CPU</span><span style="text-align:right">MEM</span></div>';
      for (var p = 0; p < data.processes.length; p++) {
        var proc = data.processes[p];
        var colour = proc.cpu >= 10 ? 'var(--bad)' : proc.cpu >= 5 ? 'var(--warn)' : 'var(--fg-3)';
        phtml += '<div class="proc-row"><span class="proc-rank">' + (p + 1) + '</span>' +
          '<span class="proc-name">' + esc(proc.name) + '</span>' +
          '<span class="proc-cpu" style="color:' + colour + '">' + proc.cpu + '%</span>' +
          '<span class="proc-mem">' + proc.mem + '%</span></div>';
      }
      dom.procList.innerHTML = phtml;
    }

    // Battery
    if (data.battery) {
      dom.secBattery.style.display = '';
      dom.batPct.textContent = data.battery.percent + '%';
      dom.batBar.className = 'progress-fill ' + loadClass(100 - data.battery.percent);
      dom.batBar.style.width = data.battery.percent + '%';
      dom.batStatus.textContent = data.battery.charging ? 'Charging' : data.battery.acConnected ? 'On AC' : 'On battery';
    } else dom.secBattery.style.display = 'none';

    // OS
    if (data.os) {
      dom.osDistro.textContent = data.os.distro + ' ' + data.os.release;
      if (data.os.uptime) dom.osUptime.textContent = 'up ' + fmtUptime(data.os.uptime);
    }

    // Measured cost of the last cycle — the performance claim, on screen.
    if (data.metrics) {
      var m = data.metrics;
      if (m.fastMs != null) {
        dom.perfReadout.textContent = m.fastMs.toFixed(1) + ' ms';
        dom.perfReadout.title = 'Fast metrics cycle: ' + m.fastMs.toFixed(1) + ' ms (node:os, every ' + m.refreshInterval +
          ' ms)\nHardware cycle: ' + (m.slowMs != null ? m.slowMs.toFixed(1) + ' ms' : '—') + ' (systeminformation, every ' + m.slowInterval +
          ' ms)\nHardware calls: ' + (m.slowCalls || []).join(', ');
      }
      if (dom.metricInfo) {
        dom.metricInfo.textContent = 'fast ' + (m.fastMs != null ? m.fastMs.toFixed(1) : '—') + ' ms every ' + m.refreshInterval +
          ' ms · hardware ' + (m.slowMs != null ? m.slowMs.toFixed(1) : '—') + ' ms every ' + m.slowInterval + ' ms';
      }
    }
  }

  // ── main-process events ───────────────────────────────
  api.on('system-data', function (data) { scheduleUpdate(data); });
  api.on('visibility-changed', function (v) { document.body.style.opacity = v ? '1' : '0'; });
  api.on('position-lock-changed', function (locked) {
    positionLocked = locked;
    // The padlock icon follows from the body class (see styles.css), so the
    // button's markup is never rewritten here.
    document.body.classList.toggle('locked', locked);
    document.body.classList.toggle('unlocked', !locked);
    updateSettingsUI(currentConfig);
  });
  api.on('compact-mode-changed', function (compact) {
    document.body.classList.toggle('compact', compact);
    currentConfig.compactMode = compact;
    updateSettingsUI(currentConfig);
  });
  api.on('theme-changed', function (theme) {
    document.body.setAttribute('data-theme', theme);
    currentConfig.theme = theme;
    updateSettingsUI(currentConfig);
  });
  api.on('layout-changed', function (layout) {
    document.body.setAttribute('data-layout', layout);
    currentConfig.layout = layout;
    updateSettingsUI(currentConfig);
  });
  api.on('config-changed', function (cfg) {
    currentConfig = cfg;
    document.body.classList.toggle('compact', cfg.compactMode);
    document.body.setAttribute('data-theme', cfg.theme);
    document.body.setAttribute('data-layout', cfg.layout || 'sidebar');
    applySectionVisibility(cfg);
    updateSettingsUI(cfg);
  });
  api.on('toggle-settings', function () { toggleSettings(); });
  api.on('app-version', function (info) {
    if (info && info.version) {
      dom.appVersion.textContent = 'v' + info.version;
      if (dom.suiteVersion) dom.suiteVersion.textContent = 'v' + info.version;
    }
  });

  // ── initial load ──────────────────────────────────────
  api.getAppInfo().then(function (info) {
    dom.appVersion.textContent = 'v' + info.version;
    if (dom.suiteVersion) dom.suiteVersion.textContent = 'v' + info.version;
    dom.appVersion.title = 'SysGlance ' + info.version + '\nElectron ' + info.electron + ' · Chromium ' + info.chrome +
      ' · Node ' + info.node + '\nShell host: ' + info.shellHost;
    if (dom.appInfo) {
      dom.appInfo.textContent = 'SysGlance ' + info.version + ' · Electron ' + info.electron + ' · shell host: ' + info.shellHost;
    }
  }).catch(function () { /* version is cosmetic */ });

  api.getSystemData().then(function (data) {
    if (data.config) {
      currentConfig = data.config;
      applySectionVisibility(data.config);
      updateSettingsUI(data.config);
    }
    scheduleUpdate(data);
  }).catch(function () { /* the interval will retry */ });
})();
