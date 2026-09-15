(function () {
  'use strict';

  var api = window.sysglance;
  if (!api) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = { config: {}, locked: false, diskSig: '', procSig: '', folderSig: '' };
  var sections = ['cpu','memory','gpu','network','disks','processes','filesystem','battery'];

  function setText(el, value) {
    if (!el) return;
    var next = value == null ? '' : String(value);
    if (el.textContent !== next) el.textContent = next;
  }

  function setWidth(el, pct) {
    if (!el) return;
    var n = Math.max(0, Math.min(100, Number(pct) || 0));
    var v = n.toFixed(1) + '%';
    if (el.style.width !== v) el.style.width = v;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function loadClass(value) {
    var n = Number(value) || 0;
    return n >= 90 ? 'danger' : n >= 72 ? 'warn' : '';
  }

  function paintMeter(el, value, invert) {
    if (!el) return;
    setWidth(el, value);
    var severity = invert ? 100 - Number(value || 0) : Number(value || 0);
    el.className = 'meter-fill ' + loadClass(severity);
  }

  function fmtBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return Math.round(n) + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    if (n < 1099511627776) return (n / 1073741824).toFixed(1) + ' GB';
    return (n / 1099511627776).toFixed(1) + ' TB';
  }

  function fmtSpeed(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return Math.round(n) + ' B/s';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB/s';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB/s';
    return (n / 1073741824).toFixed(1) + ' GB/s';
  }

  function fmtUptime(seconds) {
    var s = Math.max(0, Number(seconds) || 0);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  }

  function sliderFill(input) {
    if (!input) return;
    var min = Number(input.min) || 0;
    var max = Number(input.max) || 100;
    var value = Number(input.value) || 0;
    var pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct.toFixed(1) + '%');
  }

  function updateClock() {
    setText($('status-clock'), new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  }
  updateClock();
  setInterval(updateClock, 30000);

  function applyConfig(cfg) {
    if (!cfg) return;
    state.config = cfg;
    document.body.setAttribute('data-theme', cfg.theme || 'dark');
    document.body.setAttribute('data-layout', cfg.layout || 'sidebar');

    var visible = cfg.showSections || {};
    sections.forEach(function (key) {
      var el = $('sec-' + key);
      if (el) el.classList.toggle('hidden-section', visible[key] === false);
    });

    document.querySelectorAll('#layout-options button').forEach(function (b) { b.classList.toggle('active', b.dataset.layout === cfg.layout); });
    document.querySelectorAll('#theme-options button').forEach(function (b) { b.classList.toggle('active', b.dataset.theme === cfg.theme); });
    document.querySelectorAll('#anchor-options button').forEach(function (b) { b.classList.toggle('active', b.dataset.anchor === cfg.anchor); });
    document.querySelectorAll('#section-toggles input').forEach(function (cb) { cb.checked = visible[cb.dataset.section] !== false; });

    var opacity = Math.round((cfg.opacity || .94) * 100);
    $('settings-opacity').value = opacity;
    setText($('opacity-val'), opacity + '%');
    $('settings-refresh').value = cfg.refreshInterval || 1500;
    setText($('refresh-val'), ((cfg.refreshInterval || 1500) / 1000).toFixed(2).replace(/0+$/,'').replace(/\.$/,'') + 's');
    $('settings-slow').value = cfg.slowInterval || 7000;
    setText($('slow-val'), ((cfg.slowInterval || 7000) / 1000).toFixed(0) + 's');
    sliderFill($('settings-opacity'));
    sliderFill($('settings-refresh'));
    sliderFill($('settings-slow'));
  }

  function toggleSettings(show) {
    var panel = $('settings-panel');
    var next = show == null ? panel.classList.contains('hidden') : show;
    panel.classList.toggle('hidden', !next);
  }

  function renderCpu(cpu) {
    if (!cpu) return;
    var load = Number(cpu.load) || 0;
    setText($('cpu-load'), load.toFixed(1));
    paintMeter($('cpu-bar'), load, false);
    setText($('cpu-model'), cpu.model || 'CPU');
    var speed = cpu.speed ? (Number(cpu.speed) / 1000).toFixed(2) + ' GHz' : '';
    setText($('cpu-speed'), [speed, cpu.cores ? cpu.cores + ' cores' : ''].filter(Boolean).join(' · '));
    var temp = $('cpu-temp');
    if (cpu.temp != null) {
      setText(temp, Math.round(cpu.temp) + '°C');
      temp.classList.remove('hidden');
    } else temp.classList.add('hidden');

    var per = cpu.perCore || [];
    var html = '';
    for (var i = 0; i < Math.min(per.length, 24); i++) {
      html += '<span class="core" title="Core ' + i + ': ' + Number(per[i]).toFixed(0) + '%"><i style="height:' + Math.max(8, Math.min(100, Number(per[i]) || 0)) + '%"></i></span>';
    }
    if ($('cpu-percore').innerHTML !== html) $('cpu-percore').innerHTML = html;
  }

  function renderMemory(memory) {
    if (!memory || !memory.total) return;
    var pct = Number(memory.percentage) || 0;
    setText($('mem-pct'), pct.toFixed(1));
    paintMeter($('mem-bar'), pct, false);
    setText($('mem-used'), fmtBytes(memory.used) + ' / ' + fmtBytes(memory.total));
    setText($('mem-swap'), memory.swapTotal > 0 ? 'swap ' + fmtBytes(memory.swapUsed) : '');
  }

  function renderGpu(gpus) {
    var gpu = gpus && gpus.length ? gpus[0] : null;
    if (!gpu) {
      setText($('gpu-load'), '—');
      setText($('gpu-name'), 'Not reported');
      setText($('gpu-vram'), '');
      setWidth($('gpu-bar'), 0);
      $('gpu-temp').classList.add('hidden');
      return;
    }
    var load = gpu.utilization == null ? 0 : Number(gpu.utilization);
    setText($('gpu-load'), gpu.utilization == null ? '—' : load.toFixed(0));
    paintMeter($('gpu-bar'), load, false);
    setText($('gpu-name'), gpu.name || 'GPU');
    if (gpu.vram && gpu.vramUsed != null) setText($('gpu-vram'), fmtBytes(gpu.vramUsed) + ' / ' + fmtBytes(gpu.vram));
    else setText($('gpu-vram'), '');
    if (gpu.temp != null) {
      setText($('gpu-temp'), Math.round(gpu.temp) + '°C');
      $('gpu-temp').classList.remove('hidden');
    } else $('gpu-temp').classList.add('hidden');
  }

  function renderNetwork(net) {
    if (!net) return;
    setText($('net-iface'), net.iface || 'network');
    setText($('net-rx'), fmtSpeed(net.rx_sec));
    setText($('net-tx'), fmtSpeed(net.tx_sec));
  }

  function renderDisks(disks) {
    var list = disks || [];
    if (!list.length) {
      setText($('disk-summary'), 'No storage data');
      $('disk-list').innerHTML = '';
      state.diskSig = '';
      return;
    }
    setText($('disk-summary'), list.length + (list.length === 1 ? ' volume' : ' volumes'));
    var sig = list.map(function (d) { return [d.mount,d.fs,d.use,d.used,d.size].join(':'); }).join('|');
    if (sig === state.diskSig) return;
    state.diskSig = sig;
    $('disk-list').innerHTML = list.slice(0, 4).map(function (d) {
      var use = Math.max(0, Math.min(100, Number(d.use) || 0));
      return '<div class="disk-item"><span class="disk-name">' + esc(d.mount || d.fs || 'Disk') + '</span>' +
        '<span class="disk-pct">' + use.toFixed(0) + '%</span>' +
        '<div class="meter"><div class="meter-fill ' + loadClass(use) + '" style="width:' + use + '%"></div></div>' +
        '<span class="disk-size">' + esc(fmtBytes(d.used) + ' / ' + fmtBytes(d.size)) + '</span></div>';
    }).join('');
  }

  function renderProcesses(processes) {
    var list = processes || [];
    var sig = list.map(function (p) { return [p.name,p.cpu,p.mem].join(':'); }).join('|');
    if (sig === state.procSig) return;
    state.procSig = sig;
    $('proc-list').innerHTML = list.slice(0, 5).map(function (p, i) {
      return '<div class="proc-row"><span class="proc-rank">' + (i + 1) + '</span><span class="proc-name">' + esc(p.name) + '</span>' +
        '<span class="proc-cpu">' + Number(p.cpu || 0).toFixed(1) + '%</span><span class="proc-mem">' + Number(p.mem || 0).toFixed(1) + '%</span></div>';
    }).join('');
  }

  function renderFolders(fs) {
    var folders = fs && fs.folders ? fs.folders : [];
    setText($('fs-home'), fs && fs.home ? String(fs.home).replace(/^\/home\/[^/]+/, '~') : '');
    var sig = folders.map(function (f) { return [f.name,f.path,f.count].join(':'); }).join('|');
    if (sig === state.folderSig) return;
    state.folderSig = sig;
    $('fs-folders').innerHTML = folders.slice(0, 6).map(function (f) {
      return '<button class="folder-chip" data-path="' + esc(f.path) + '" title="' + esc(f.path) + '"><svg class="ic" viewBox="0 0 24 24"><use href="#i-files"/></svg><span>' + esc(f.name) + '</span><small>' + Number(f.count || 0) + '</small></button>';
    }).join('');
    document.querySelectorAll('.folder-chip').forEach(function (button) {
      button.addEventListener('click', function () { api.openFolder(button.dataset.path); });
    });
  }

  function renderBattery(battery) {
    var card = $('sec-battery');
    var allowed = !state.config.showSections || state.config.showSections.battery !== false;
    if (!battery || !allowed) {
      card.classList.add('hidden-section');
      return;
    }
    card.classList.remove('hidden-section');
    setText($('bat-pct'), Math.round(battery.percent) + '%');
    setText($('bat-status'), battery.charging ? 'Charging' : battery.acConnected ? 'On AC' : 'On battery');
    paintMeter($('bat-bar'), battery.percent, true);
  }

  function render(data) {
    if (!data) return;
    if (data.config) applyConfig(data.config);
    renderCpu(data.cpu);
    renderMemory(data.memory);
    renderGpu(data.gpu);
    renderNetwork(data.network);
    renderDisks(data.disks);
    renderProcesses(data.processes);
    renderFolders(data.filesystem);
    renderBattery(data.battery);

    if (data.os) {
      setText($('os-distro'), [data.os.distro, data.os.release].filter(Boolean).join(' '));
      setText($('os-uptime'), data.os.uptime ? 'up ' + fmtUptime(data.os.uptime) : '');
    }
    if (data.metrics) {
      var f = data.metrics.fastMs;
      var s = data.metrics.slowMs;
      setText($('perf-readout'), f == null ? '— ms' : Number(f).toFixed(1) + ' ms');
      setText($('metric-info'), 'live ' + (f == null ? '—' : Number(f).toFixed(1) + 'ms') + ' · hardware ' + (s == null ? '—' : Number(s).toFixed(1) + 'ms'));
    }
  }

  $('btn-settings').addEventListener('click', function () { toggleSettings(); });
  $('btn-close-settings').addEventListener('click', function () { toggleSettings(false); });
  $('btn-lock').addEventListener('click', function () { api.togglePositionLock(); });
  $('btn-minimize').addEventListener('click', function () { api.toggleVisibility(); });

  $('layout-options').addEventListener('click', function (e) { var b=e.target.closest('button[data-layout]'); if(b) api.setConfig('layout', b.dataset.layout); });
  $('theme-options').addEventListener('click', function (e) { var b=e.target.closest('button[data-theme]'); if(b) api.setConfig('theme', b.dataset.theme); });
  $('anchor-options').addEventListener('click', function (e) { var b=e.target.closest('button[data-anchor]'); if(b) api.setConfig('anchor', b.dataset.anchor); });
  $('section-toggles').addEventListener('change', function (e) {
    if (!e.target.dataset.section) return;
    var next = Object.assign({}, state.config.showSections || {});
    next[e.target.dataset.section] = e.target.checked;
    api.setConfig('showSections', next);
  });

  $('settings-opacity').addEventListener('input', function (e) {
    sliderFill(e.target); setText($('opacity-val'), e.target.value + '%'); api.setOpacity(Number(e.target.value) / 100);
  });
  $('settings-refresh').addEventListener('change', function (e) { api.setConfig('refreshInterval', Number(e.target.value)); });
  $('settings-slow').addEventListener('change', function (e) { api.setConfig('slowInterval', Number(e.target.value)); });
  $('settings-refresh').addEventListener('input', function (e) { sliderFill(e.target); setText($('refresh-val'), (Number(e.target.value)/1000).toFixed(2).replace(/0+$/,'').replace(/\.$/,'') + 's'); });
  $('settings-slow').addEventListener('input', function (e) { sliderFill(e.target); setText($('slow-val'), (Number(e.target.value)/1000).toFixed(0) + 's'); });

  api.on('system-data', render);
  api.on('config-changed', applyConfig);
  api.on('theme-changed', function (theme) { document.body.setAttribute('data-theme', theme); });
  api.on('layout-changed', function (layout) { document.body.setAttribute('data-layout', layout); });
  api.on('position-lock-changed', function (locked) {
    state.locked = !!locked;
    document.body.classList.toggle('locked', state.locked);
    document.body.classList.toggle('unlocked', !state.locked);
  });
  api.on('toggle-settings', function () { toggleSettings(); });
  api.on('app-version', function (info) { if (info && info.version) setText($('app-version'), 'v' + info.version); });

  api.getAppInfo().then(function (info) {
    setText($('app-version'), 'v' + info.version);
    setText($('app-info'), 'SysGlance ' + info.version + ' · Electron ' + info.electron);
  });
  api.getSystemData().then(render);
})();
