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
    secHealth: $('sec-health'), healthSummary: $('health-summary'), healthList: $('health-list'), historyWindow: $('history-window'),
    secGpu: $('sec-gpu'),
    diskList: $('disk-list'), diskActivity: $('disk-activity'), diskActivityValue: $('disk-activity-value'), storageAnalyze: $('storage-analyze'), storageAnalysis: $('storage-analysis'),
    netIface: $('net-iface'), netRx: $('net-rx'), netTx: $('net-tx'), netPeak: $('net-peak'), netSession: $('net-session'), netDetails: $('net-details'),
    procList: $('proc-list'), processStatus: $('process-status'), processFilter: $('process-filter'),
    batPct: $('bat-pct'), batBar: $('bat-bar'), batStatus: $('bat-status'), secBattery: $('sec-battery'),
    osDistro: $('os-distro'), osUptime: $('os-uptime'),
    btnLock: $('btn-lock'), btnSettings: $('btn-settings'), btnMinimize: $('btn-minimize'),
    statusClock: $('status-clock'), perfReadout: $('perf-readout'), appVersion: $('app-version'),
    cpuSparkline: $('cpu-sparkline'), memorySparkline: $('memory-sparkline'),
    content: $('content'),
    suiteVersion: $('suite-version'),
    settingsPanel: $('settings-panel'), btnCloseSettings: $('btn-close-settings'),
    settingsOpacity: $('settings-opacity'), settingsRefresh: $('settings-refresh'), settingsSlow: $('settings-slow'),
    opacityVal: $('opacity-val'), refreshVal: $('refresh-val'), slowVal: $('slow-val'),
    btnLockSettings: $('btn-lock-settings'), btnCompactSettings: $('btn-compact-settings'),
    layoutOptions: $('layout-options'), anchorOptions: $('anchor-options'),
    themeOptions: $('theme-options'), displayOptions: $('display-options'), hotkeyToggle: $('hotkey-toggle'), hotkeyLock: $('hotkey-lock'), hotkeyPalette: $('hotkey-palette'), sectionToggles: $('section-toggles'),
    profileSelect: $('profile-select'), profileName: $('profile-name'), profileSave: $('profile-save'),
    profileApply: $('profile-apply'), profileApplyShell: $('profile-apply-shell'), profileDelete: $('profile-delete'), profileDuplicate: $('profile-duplicate'),
    profileExport: $('profile-export'), profileImport: $('profile-import'), profileUndo: $('profile-undo'), profileStatus: $('profile-status'),
    inspectorSummary: $('inspector-summary'), inspectorRefresh: $('inspector-refresh'),
    diagnosticsCopy: $('diagnostics-copy'), diagnosticsExport: $('diagnostics-export'), diagnosticsBundle: $('diagnostics-bundle'), diagnosticsOpenLogs: $('diagnostics-open-logs'), diagnosticsStatus: $('diagnostics-status'),
    commandPalette: $('command-palette'), palettePrefix: $('palette-prefix'), paletteInput: $('palette-input'), paletteList: $('palette-list'), paletteClose: $('palette-close'),
    appInfo: $('app-info'), metricInfo: $('metric-info')
  };

  // ── state ─────────────────────────────────────────────
  var positionLocked = true;
  var currentConfig = {};
  var inspectorLoaded = false;
  var networkDetailsLoaded = false;
  var lastProcessData = [];

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
  // Assigning textContent unconditionally invalidates style and layout even when
  // the value is identical. Every value that updates on a timer goes through
  // these, so a steady reading costs no repaint at all.
  function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }
  function setWidth(el, pct) { var w = pct + '%'; if (el && el.style.width !== w) el.style.width = w; }
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
  // Minute precision is all a clock needs: schedule the next repaint for the
  // top of the next minute instead of firing once a second for nothing.
  function updateClock() {
    setText(dom.statusClock, new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  }
  function startClock() {
    updateClock();
    var now = new Date();
    var delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 40;
    setTimeout(startClock, delay);
  }
  startClock();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) updateClock(); });
  window.addEventListener('focus', updateClock);

  // ── collapsible cards ─────────────────────────────────
  // One delegated listener covers every card, including the Shell panel that
  // shell/panel.js injects after this file has already run. Collapsing keeps the
  // card's headline value visible, so a folded card still tells you the number.
  var COLLAPSIBLE = ['health', 'cpu', 'memory', 'gpu', 'filesystem', 'disks', 'network', 'processes', 'battery', 'shell'];

  function sectionKey(sec) {
    if (!sec || !sec.id) return null;
    var key = sec.id.replace(/^sec-/, '');
    return COLLAPSIBLE.indexOf(key) === -1 ? null : key;
  }

  function applyCollapsed(cfg) {
    var list = (cfg && cfg.collapsedSections) || [];
    document.querySelectorAll('.section').forEach(function (sec) {
      var key = sectionKey(sec);
      var header = sec.querySelector('.section-header');
      if (!key || !header) return;
      var collapsed = list.indexOf(key) !== -1;
      sec.classList.toggle('is-collapsed', collapsed);
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      header.title = collapsed ? 'Expand' : 'Collapse';
    });
  }

  function toggleSection(sec) {
    var key = sectionKey(sec);
    if (!key) return;
    var list = ((currentConfig && currentConfig.collapsedSections) || []).slice();
    var i = list.indexOf(key);
    if (i === -1) list.push(key); else list.splice(i, 1);
    currentConfig.collapsedSections = list;
    applyCollapsed(currentConfig);
    api.setConfig('collapsedSections', list);
  }

  function sectionFromEvent(ev) {
    if (!ev.target || !ev.target.closest) return null;
    var header = ev.target.closest('.section-header');
    if (!header) return null;
    if (ev.target.closest('button, input, select, textarea')) return null;   // controls inside a header are not collapse toggles
    return header.parentElement;
  }

  dom.content.addEventListener('click', function (ev) {
    var sec = sectionFromEvent(ev);
    if (sec) toggleSection(sec);
  });
  dom.content.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var sec = sectionFromEvent(ev);
    if (sec) { ev.preventDefault(); toggleSection(sec); }
  });

  // ── settings panel ────────────────────────────────────
  function toggleSettings(show) {
    if (show === undefined) show = dom.settingsPanel.classList.contains('hidden');
    dom.settingsPanel.classList.toggle('hidden', !show);
    if (show && !inspectorLoaded) refreshInspector();
  }

  function renderDisplays(displays) {
    if (!dom.displayOptions || !Array.isArray(displays)) return;
    var selected = dom.displayOptions.value;
    var html = '<option value="">Primary display</option>';
    displays.forEach(function (display) {
      var label = display.label || ('Display ' + display.id);
      var suffix = display.primary ? ' · primary' : '';
      if (display.scaleFactor && display.scaleFactor !== 1) suffix += ' · ' + Math.round(display.scaleFactor * 100) + '%';
      if (display.refreshRate) suffix += ' · ' + Math.round(display.refreshRate) + ' Hz';
      html += '<option value="' + esc(display.id) + '">' + esc(label + suffix) + '</option>';
    });
    dom.displayOptions.innerHTML = html;
    if (selected && Array.prototype.some.call(dom.displayOptions.options, function (option) { return option.value === selected; })) {
      dom.displayOptions.value = selected;
    }
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
    if (dom.displayOptions) dom.displayOptions.value = cfg.displayId == null ? '' : String(cfg.displayId);
    var hotkeys = cfg.hotkeys || {};
    if (dom.hotkeyToggle) dom.hotkeyToggle.value = hotkeys.toggle || '';
    if (dom.hotkeyLock) dom.hotkeyLock.value = hotkeys.lock || '';
    if (dom.hotkeyPalette) dom.hotkeyPalette.value = hotkeys.palette || '';
    if (dom.palettePrefix) dom.palettePrefix.textContent = String(hotkeys.palette || 'Off').replace('CommandOrControl', 'Ctrl');
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

  function profileStatus(text, bad) {
    if (!dom.profileStatus) return;
    dom.profileStatus.textContent = text;
    dom.profileStatus.classList.toggle('is-alert', !!bad);
  }

  function selectedProfileName() {
    return dom.profileSelect && dom.profileSelect.value ? dom.profileSelect.value : (dom.profileName && dom.profileName.value || '').trim();
  }

  function renderProfiles(items) {
    if (!dom.profileSelect) return;
    var selected = dom.profileSelect.value;
    var html = '<option value="">' + (items.length ? 'Choose a profile' : 'No saved profiles') + '</option>';
    (items || []).forEach(function (item) { html += '<option value="' + esc(item.name) + '">' + esc(item.name) + '</option>'; });
    dom.profileSelect.innerHTML = html;
    if ((items || []).some(function (item) { return item.name === selected; })) dom.profileSelect.value = selected;
  }

  function refreshProfiles() {
    if (!api.profiles || !api.profiles.list) return;
    api.profiles.list().then(function (res) {
      if (res && res.ok) renderProfiles(res.profiles || []);
      else profileStatus((res && res.error) || 'Could not read profiles', true);
    }).catch(function (err) { profileStatus(err.message || 'Could not read profiles', true); });
  }

  function runProfile(action, successText) {
    var name = selectedProfileName();
    if (!name) { profileStatus('Choose or enter a profile name', true); return; }
    action(name).then(function (res) {
      if (!res || !res.ok) { profileStatus((res && res.error) || 'Profile action failed', true); return; }
      profileStatus(successText + (res.shellPending ? ' Shell settings remain pending confirmation.' : ''));
      refreshProfiles();
    }).catch(function (err) { profileStatus(err.message || 'Profile action failed', true); });
  }

  function diagnosticsStatus(text, bad) {
    if (!dom.diagnosticsStatus) return;
    dom.diagnosticsStatus.textContent = text;
    dom.diagnosticsStatus.classList.toggle('is-alert', !!bad);
  }

  function renderInspector(result) {
    if (!dom.inspectorSummary || !result || !result.hardware) return;
    var h = result.hardware;
    var lines = [];
    if (h.cpu && h.cpu.model) lines.push('<strong>CPU</strong> ' + esc(h.cpu.model) + (h.cpu.cores ? ' · ' + h.cpu.cores + ' cores' : ''));
    if (h.os && (h.os.distro || h.os.release)) lines.push('<strong>Windows</strong> ' + esc([h.os.distro, h.os.release, h.os.build].filter(Boolean).join(' ')));
    if (h.system && (h.system.manufacturer || h.system.model)) lines.push('<strong>System</strong> ' + esc([h.system.manufacturer, h.system.model].filter(Boolean).join(' ')));
    if (h.baseboard && (h.baseboard.manufacturer || h.baseboard.model)) lines.push('<strong>Board</strong> ' + esc([h.baseboard.manufacturer, h.baseboard.model].filter(Boolean).join(' ')));
    if (h.bios && (h.bios.vendor || h.bios.version)) lines.push('<strong>BIOS</strong> ' + esc([h.bios.vendor, h.bios.version].filter(Boolean).join(' ')));
    if (h.graphics && h.graphics.controllers && h.graphics.controllers.length) lines.push('<strong>GPU</strong> ' + esc(h.graphics.controllers.map(function (item) { return item.model; }).filter(Boolean).join(', ')));
    if (h.storage && h.storage.length) lines.push('<strong>Storage</strong> ' + esc(h.storage.map(function (item) { return item.name; }).filter(Boolean).join(', ')));
    if (h.memory && h.memory.length) lines.push('<strong>Memory</strong> ' + h.memory.length + ' module' + (h.memory.length === 1 ? '' : 's'));
    if (h.network && h.network.length) lines.push('<strong>Network</strong> ' + esc(h.network.map(function (item) { return item.ifaceName || item.iface; }).filter(Boolean).join(', ')));
    if (h.battery) lines.push('<strong>Battery</strong> ' + (h.battery.percent == null ? 'present' : h.battery.percent + '%') + (h.battery.charging ? ' · charging' : ''));
    if (result.displays && result.displays.length) lines.push('<strong>Displays</strong> ' + result.displays.length + ' · ' + esc(result.displays.map(function (item) { return item.label; }).join(', ')));
    dom.inspectorSummary.innerHTML = lines.length ? lines.join('<br>') : 'No hardware identity data reported.';
  }
  function refreshInspector() {
    if (!api.diagnostics || !api.diagnostics.inspect) return;
    if (dom.inspectorSummary) dom.inspectorSummary.textContent = 'Reading hardware identity…';
    api.diagnostics.inspect(true).then(function (res) {
      if (!res || !res.ok) { if (dom.inspectorSummary) dom.inspectorSummary.textContent = (res && res.error) || 'Hardware identity unavailable.'; return; }
      inspectorLoaded = true;
      renderInspector(res);
    }).catch(function (err) { if (dom.inspectorSummary) dom.inspectorSummary.textContent = err.message || 'Hardware identity unavailable.'; });
  }

  if (dom.profileSelect) dom.profileSelect.addEventListener('change', function () {
    if (dom.profileName) dom.profileName.value = dom.profileSelect.value;
  });
  if (dom.profileSave) dom.profileSave.addEventListener('click', function () {
    runProfile(function (name) { return api.profiles.save(name); }, 'Profile saved.');
  });
  if (dom.profileApply) dom.profileApply.addEventListener('click', function () {
    runProfile(function (name) { return api.profiles.apply(name); }, 'Profile applied.');
  });
  if (dom.profileApplyShell) dom.profileApplyShell.addEventListener('click', function () {
    runProfile(function (name) { return api.profiles.applyShell(name); }, 'Shell settings applied.');
  });
  if (dom.profileDelete) dom.profileDelete.addEventListener('click', function () {
    runProfile(function (name) { return api.profiles.remove(name); }, 'Profile deleted.');
  });
  if (dom.profileDuplicate) dom.profileDuplicate.addEventListener('click', function () {
    var source = selectedProfileName();
    var target = (dom.profileName && dom.profileName.value || '').trim();
    if (!source || !target || source === target) { profileStatus('Choose a source and a different target name', true); return; }
    api.profiles.duplicate(source, target).then(function (res) {
      if (!res || !res.ok) { profileStatus((res && res.error) || 'Could not duplicate profile', true); return; }
      profileStatus('Profile duplicated.'); refreshProfiles();
    });
  });
  if (dom.profileExport) dom.profileExport.addEventListener('click', function () {
    runProfile(function (name) { return api.profiles.export(name); }, 'Profile exported.');
  });
  if (dom.profileImport) dom.profileImport.addEventListener('click', function () {
    api.profiles.import().then(function (res) {
      if (!res || !res.ok) { if (!res || !res.canceled) profileStatus((res && res.error) || 'Could not import profile', true); return; }
      profileStatus('Profile imported.'); refreshProfiles();
    });
  });
  if (dom.profileUndo) dom.profileUndo.addEventListener('click', function () {
    api.profiles.undo().then(function (res) {
      if (!res || !res.ok) { profileStatus((res && res.error) || 'Nothing to undo', true); return; }
      profileStatus('Last profile apply undone.');
    }).catch(function (err) { profileStatus(err.message || 'Could not undo profile', true); });
  });
  if (dom.diagnosticsCopy) dom.diagnosticsCopy.addEventListener('click', function () {
    api.diagnostics.copy().then(function (res) {
      if (!res || !res.ok) diagnosticsStatus((res && res.error) || 'Could not copy diagnostics', true);
      else diagnosticsStatus('Summary copied to clipboard.');
    }).catch(function (err) { diagnosticsStatus(err.message || 'Could not copy diagnostics', true); });
  });
  if (dom.diagnosticsExport) dom.diagnosticsExport.addEventListener('click', function () {
    api.diagnostics.export().then(function (res) {
      if (!res || !res.ok) { if (!res || !res.canceled) diagnosticsStatus((res && res.error) || 'Could not export diagnostics', true); }
      else diagnosticsStatus('Diagnostics exported.');
    }).catch(function (err) { diagnosticsStatus(err.message || 'Could not export diagnostics', true); });
  });
  if (dom.diagnosticsBundle && api.diagnostics.bundle) dom.diagnosticsBundle.addEventListener('click', function () {
    api.diagnostics.bundle().then(function (res) {
      if (!res || !res.ok) { if (!res || !res.canceled) diagnosticsStatus((res && res.error) || 'Could not export support bundle', true); }
      else diagnosticsStatus('Support bundle exported.');
    }).catch(function (err) { diagnosticsStatus(err.message || 'Could not export support bundle', true); });
  });
  if (dom.diagnosticsOpenLogs) dom.diagnosticsOpenLogs.addEventListener('click', function () {
    if (!api.diagnostics.openLogs) return;
    api.diagnostics.openLogs().then(function (res) {
      if (!res || !res.ok) diagnosticsStatus((res && res.error) || 'Could not open logs', true);
      else diagnosticsStatus('Logs opened.');
    }).catch(function (err) { diagnosticsStatus(err.message || 'Could not open logs', true); });
  });
  if (dom.inspectorRefresh) dom.inspectorRefresh.addEventListener('click', refreshInspector);
  if (dom.storageAnalyze && api.storage) dom.storageAnalyze.addEventListener('click', function () {
    dom.storageAnalyze.disabled = true;
    setText(dom.storageAnalysis, 'Scanning home folders on request…');
    api.storage.analyzeHome().then(function (res) {
      if (!res || !res.ok) { setText(dom.storageAnalysis, (res && res.error) || 'Folder analysis unavailable'); return; }
      var details = (res.entries || []).slice(0, 5).map(function (item) { return item.name + ' ' + fmtBytes(item.size); }).join(' · ');
      setText(dom.storageAnalysis, details || ('No subfolders found' + (res.truncated ? ' · scan capped' : '')));
    }).catch(function (err) { setText(dom.storageAnalysis, err.message || 'Folder analysis unavailable'); }).finally(function () { dom.storageAnalyze.disabled = false; });
  });
  if (dom.historyWindow && api.history) dom.historyWindow.addEventListener('change', function () {
    api.history.setWindow(Number(dom.historyWindow.value)).then(function (res) {
      if (!res || !res.ok) diagnosticsStatus((res && res.error) || 'History window unavailable', true);
    }).catch(function (err) { diagnosticsStatus(err.message || 'History window unavailable', true); });
  });

  // ── command palette ──────────────────────────────────
  var PALETTE_COMMANDS = [
    { label: 'Open settings', terms: 'settings preferences', run: function () { toggleSettings(true); } },
    { label: 'Open Windows Settings', terms: 'settings control panel', action: 'settings' },
    { label: 'Open network settings', terms: 'network wifi ethernet internet', action: 'network' },
    { label: 'Open display settings', terms: 'display monitor screen dpi', action: 'display' },
    { label: 'Open Apps settings', terms: 'apps applications uninstall', action: 'apps' },
    { label: 'Open Task Manager', terms: 'task manager processes cpu', action: 'taskManager' },
    { label: 'Open Windows Services', terms: 'services background service manager', action: 'services' },
    { label: 'Lock PC', terms: 'lock workstation security', action: 'lock' },
    { label: 'Sleep PC', terms: 'sleep suspend standby power', action: 'sleep' },
    { label: 'Restart PC', terms: 'restart reboot power', action: 'restart' },
    { label: 'Show system status', terms: 'status health', section: 'health' },
    { label: 'Show CPU', terms: 'cpu processor', section: 'cpu' },
    { label: 'Show memory', terms: 'memory ram', section: 'memory' },
    { label: 'Show storage', terms: 'storage disks drive', section: 'disks' },
    { label: 'Show network', terms: 'network internet adapter', section: 'network' },
    { label: 'Show processes', terms: 'process task pid', section: 'processes' },
    { label: 'Open desktop profiles', terms: 'profiles workspace layout', run: function () { toggleSettings(true); if (dom.profileSelect) dom.profileSelect.focus(); } },
    { label: 'Hide SysGlance', terms: 'hide tray minimize', run: function () { api.toggleVisibility(); } }
  ];
  var paletteMatches = [];
  function renderPalette(query) {
    if (!dom.paletteList) return;
    var q = String(query || '').toLowerCase().trim();
    paletteMatches = PALETTE_COMMANDS.filter(function (item) { return !q || (item.label + ' ' + item.terms).toLowerCase().indexOf(q) !== -1; });
    dom.paletteList.innerHTML = paletteMatches.length ? paletteMatches.map(function (item, i) {
      return '<button class="palette-item" data-index="' + i + '" role="option"><span>' + esc(item.label) + '</span><span class="palette-arrow">↵</span></button>';
    }).join('') : '<div class="palette-empty">No matching SysGlance command</div>';
  }
  function closePalette() {
    if (dom.commandPalette) dom.commandPalette.classList.add('hidden');
  }
  function openPalette() {
    if (!dom.commandPalette) return;
    dom.commandPalette.classList.remove('hidden');
    dom.paletteInput.value = '';
    renderPalette('');
    setTimeout(function () { dom.paletteInput.focus(); }, 0);
  }
  function runPalette(index) {
    var item = paletteMatches[index];
    if (!item) return;
    closePalette();
    if (item.section) {
      toggleSettings(false);
      var target = $('sec-' + item.section);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (item.run) item.run();
    if (item.action && api.control && api.control.open) {
      api.control.open(item.action).then(function (res) {
        if (res && !res.ok) diagnosticsStatus(res.error || 'Control action unavailable', true);
      }).catch(function (err) { diagnosticsStatus(err.message || 'Control action unavailable', true); });
    }
  }
  if (dom.paletteInput) dom.paletteInput.addEventListener('input', function (event) { renderPalette(event.target.value); });
  if (dom.paletteInput) dom.paletteInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); runPalette(0); }
    if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
  });
  if (dom.paletteList) dom.paletteList.addEventListener('click', function (event) {
    var item = event.target.closest('.palette-item');
    if (item) runPalette(Number(item.dataset.index));
  });
  if (dom.paletteClose) dom.paletteClose.addEventListener('click', closePalette);
  if (dom.commandPalette) dom.commandPalette.addEventListener('click', function (event) { if (event.target === dom.commandPalette) closePalette(); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && dom.commandPalette && !dom.commandPalette.classList.contains('hidden')) closePalette();
  });

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
  if (dom.displayOptions) dom.displayOptions.addEventListener('change', function (e) {
    var value = e.target.value;
    api.setConfig('displayId', value ? Number(value) : null);
  });
  function setHotkey(name, value) {
    var next = Object.assign({}, currentConfig.hotkeys || {});
    next[name] = value || null;
    api.setConfig('hotkeys', next);
  }
  if (dom.hotkeyToggle) dom.hotkeyToggle.addEventListener('change', function (e) { setHotkey('toggle', e.target.value); });
  if (dom.hotkeyLock) dom.hotkeyLock.addEventListener('change', function (e) { setHotkey('lock', e.target.value); });
  if (dom.hotkeyPalette) dom.hotkeyPalette.addEventListener('change', function (e) { setHotkey('palette', e.target.value); });
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

  function processMessage(text, bad) {
    if (!dom.processStatus) return;
    dom.processStatus.textContent = text;
    dom.processStatus.classList.toggle('is-alert', !!bad);
    if (text) setTimeout(function () { if (dom.processStatus.textContent === text) dom.processStatus.textContent = ''; }, 3200);
  }

  dom.procList.addEventListener('click', function (event) {
    var button = event.target.closest('.proc-action');
    if (!button) return;
    var pid = Number(button.dataset.pid);
    var action = button.dataset.action;
    if (action === 'path' && api.copyText) {
      api.copyText(button.dataset.path || '').then(function (result) {
        if (result && result.ok) processMessage('Path copied');
        else processMessage((result && result.error) || 'Could not copy path', true);
      });
      return;
    }
    if (!Number.isInteger(pid)) return;
    var call = action === 'location' && api.processes ? api.processes.openLocation(pid) :
      action === 'end' && api.processes ? api.processes.endTask(pid) :
      action === 'pid' && api.copyText ? api.copyText(String(pid)) :
      Promise.resolve({ ok: false, error: 'process action unavailable' });
    call.then(function (result) {
      if (result && result.ok) processMessage(action === 'end' ? 'Task ended' : action === 'pid' ? 'PID copied' : 'Location opened');
      else if (result && !result.canceled) processMessage((result && result.error) || 'Process action failed', true);
    }).catch(function (err) { processMessage(err.message || 'Process action failed', true); });
  });
  if (dom.processFilter) dom.processFilter.addEventListener('input', function () {
    procSignature = '';
    scheduleUpdate({ processes: lastProcessData, config: currentConfig, layout: currentConfig.layout, timestamp: Date.now() });
  });

  var fsSignature = '';   // avoids rebuilding the folder grid (and losing focus)
  var fsStatusTimer = null;

  /** Brief message in the section header, then back to the home path. */
  function fsStatus(text) {
    if (!dom.fsHome) return;
    var home = (currentConfig && currentConfig.fsHomeLabel) || dom.fsHome.dataset.home || '';
    dom.fsHome.textContent = text;
    dom.fsHome.classList.add('is-alert');
    if (fsStatusTimer) clearTimeout(fsStatusTimer);
    fsStatusTimer = setTimeout(function () {
      dom.fsHome.textContent = home;
      dom.fsHome.classList.remove('is-alert');
    }, 2600);
  }

  function renderFolders(fs) {
    var folders = (fs && fs.folders) || [];
    var signature = fs ? fs.home + '|' + folders.map(function (f) { return f.name + ':' + f.count; }).join(',') : '';

    if (!folders.length) {
      dom.fsHome.dataset.home = '';
      dom.fsHome.textContent = '';
      if (fsSignature !== 'empty') {
        fsSignature = 'empty';
        dom.fsFolders.innerHTML = '<div class="fs-empty">No Desktop, Documents, Downloads, Pictures, Videos or Music folder found in the home directory.</div>';
      }
      return;
    }

    var label = String(fs.home).replace(/^\/home\/[^/]+/, '~');
    dom.fsHome.dataset.home = label;
    if (!dom.fsHome.classList.contains('is-alert')) dom.fsHome.textContent = label;

    if (signature === fsSignature) return;   // nothing to repaint
    fsSignature = signature;

    var html = '';
    for (var i = 0; i < folders.length; i++) {
      var folder = folders[i];
      var items = folder.count === 1 ? '1 item' : folder.count + ' items';
      html += '<div class="fs-item" role="button" tabindex="0" data-path="' + esc(folder.path) + '"' +
        ' title="' + esc(folder.path) + '" aria-label="Open ' + esc(folder.name) + ', ' + items + '">' +
        '<span class="fs-item-icon">' + FOLDER_ICON + '</span>' +
        '<span class="fs-item-info"><span class="fs-item-name">' + esc(folder.name) + '</span>' +
        '<span class="fs-item-count">' + items + '</span></span>' +
        '<span class="fs-item-go"><svg class="ic" viewBox="0 0 24 24"><use href="#i-open"/></svg></span>' +
        '</div>';
    }
    dom.fsFolders.innerHTML = html;

    dom.fsFolders.querySelectorAll('.fs-item').forEach(function (node) {
      var open = function () {
        api.openFolder(node.dataset.path).then(function (res) {
          if (!res || res.ok === false) fsStatus('Could not open ' + (node.dataset.path || '').split(/[\\/]/).pop());
        }).catch(function () { fsStatus('Could not open folder'); });
      };
      node.addEventListener('click', open);
      node.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
    });
  }

  // ── rAF-batched rendering ─────────────────────────────
  var pendingData = null, rafScheduled = false;

  // ── Incremental render caches (avoid innerHTML every 1.5s) ──
  var cpuCoreCount = 0;
  var gpuSignature = '';
  var diskSignature = '';
  var procSignature = '';

  function scheduleUpdate(data) {
    pendingData = data;
    if (!rafScheduled) { rafScheduled = true; requestAnimationFrame(applyUpdate); }
  }

  function renderSparkline(polyline, points) {
    if (!polyline || !points || !points.length) return;
    var values = points.map(function (p) { return Number(p.value); }).filter(function (v) { return Number.isFinite(v); });
    if (!values.length) return;
    var min = Math.min.apply(Math, values), max = Math.max.apply(Math, values);
    var span = max - min || 1;
    var coords = values.map(function (v, i) {
      var x = values.length === 1 ? 0 : (i / (values.length - 1)) * 120;
      var y = 22 - ((v - min) / span) * 18;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    if (polyline.getAttribute('points') !== coords) polyline.setAttribute('points', coords);
  }

  function renderHealth(health) {
    if (!health || !dom.healthList) return;
    setText(dom.healthSummary, health.message || 'No issues detected');
    var html = '';
    (health.rows || []).forEach(function (item) {
      var status = String(item.status || 'UNKNOWN').toLowerCase();
      html += '<div class="health-row health-' + status + '">' +
        '<span class="health-dot" aria-hidden="true"></span>' +
        '<span class="health-label">' + esc(item.label) + '</span>' +
        '<span class="health-detail">' + esc(item.detail) + '</span>' +
        '<span class="health-status">' + esc(item.status) + '</span></div>';
    });
    if (dom.healthList.innerHTML !== html) dom.healthList.innerHTML = html;
  }

  function applyUpdate() {
    rafScheduled = false;
    var data = pendingData;
    if (!data || data.error) return;

    if (data.layout) document.body.setAttribute('data-layout', data.layout);
    if (data.displays) renderDisplays(data.displays);

    // Objective system status: each line is backed by a current measurement.
    renderHealth(data.health);
    if (data.history && data.history.series) {
      if (dom.historyWindow && data.history.windowMs) dom.historyWindow.value = String(data.history.windowMs);
      renderSparkline(dom.cpuSparkline, data.history.series.cpu);
      renderSparkline(dom.memorySparkline, data.history.series.memory);
    }

    // CPU
    if (data.cpu) {
      var load = data.cpu.load || 0;
      setText(dom.cpuLoad, load.toFixed(1) + '%');
      dom.cpuBar.className = 'progress-fill ' + loadClass(load);
      setWidth(dom.cpuBar, Math.min(load, 100));
      setText(dom.cpuModel, data.cpu.model);
      setText(dom.cpuCores, data.cpu.cores + ' cores');
      setText(dom.cpuSpeed, data.cpu.speed ? (data.cpu.speed / 1000).toFixed(2) + ' GHz' : '');
      if (data.cpu.temp != null) {
        var hot = data.cpu.temp >= 80;
        setText(dom.cpuTemp, data.cpu.temp.toFixed(0) + '\u00b0C');
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
      setText(dom.memPct, pct.toFixed(1) + '%');
      dom.memBar.className = 'progress-fill ' + loadClass(pct);
      setWidth(dom.memBar, Math.min(pct, 100));
      setText(dom.memUsed, fmtBytes(data.memory.used) + ' / ' + fmtBytes(data.memory.total));
      setText(dom.memSwap, data.memory.swapTotal > 0
        ? 'Swap: ' + fmtBytes(data.memory.swapUsed) + '/' + fmtBytes(data.memory.swapTotal) : '');
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
    renderFolders(data.filesystem);

    // Disks
    if (data.disks && data.disks.length) {
      var dSig = data.disks.map(function(d) { return (d.mount || d.fs) + ':' + d.use; }).join('|');
      if (dSig !== diskSignature) {
        diskSignature = dSig;
        var dhtml = '';
        for (var d = 0; d < data.disks.length; d++) {
          var disk = data.disks[d];
          dhtml += '<div class="disk-item"><div class="disk-label"><span class="disk-fs">' + esc(disk.mount || disk.fs) +
            '</span><span class="disk-pct">' + disk.use + '%</span></div><div class="disk-size">' + fmtBytes(disk.used) + ' / ' + fmtBytes(disk.size) +
            '</div><div class="progress-bar"><div class="progress-fill ' + loadClass(disk.use) + '" style="width:' + Math.min(disk.use, 100) + '%"></div></div></div>';
        }
        dom.diskList.innerHTML = dhtml;
      }
    }
    if (dom.diskActivity) {
      var io = data.diskIO;
      var read = io && io.readBytesSec != null ? fmtSpeed(io.readBytesSec) : '';
      var write = io && io.writeBytesSec != null ? fmtSpeed(io.writeBytesSec) : '';
      dom.diskActivity.style.display = read || write ? '' : 'none';
      setText(dom.diskActivityValue, read || write ? 'R ' + (read || '—') + ' · W ' + (write || '—') : '');
    }

    // Network
    if (data.network) {
      setText(dom.netIface, data.network.iface);
      setText(dom.netRx, fmtSpeed(data.network.rx_sec));
      setText(dom.netTx, fmtSpeed(data.network.tx_sec));
      setText(dom.netPeak, 'Peak ' + fmtSpeed(Math.max(data.network.peakRx || 0, data.network.peakTx || 0)));
      setText(dom.netSession, 'Session ↓' + fmtBytes(data.network.sessionDownloaded || 0) + ' ↑' + fmtBytes(data.network.sessionUploaded || 0));
      var networkDetails = [data.network.adapter || data.network.iface || null, data.network.ip4 ? 'IPv4 ' + data.network.ip4 : null, data.network.gateway ? 'GW ' + data.network.gateway : null, Array.isArray(data.network.dns) && data.network.dns.length ? 'DNS ' + data.network.dns.join(', ') : null, data.network.linkSpeed ? Math.round(data.network.linkSpeed) + ' Mbps' : null].filter(Boolean).join(' · ');
      setText(dom.netDetails, networkDetails || 'Adapter details unavailable');
      if (!networkDetailsLoaded && api.network && api.network.inspect) {
        networkDetailsLoaded = true;
        api.network.inspect(false).then(function (details) {
          if (!details || details.ok === false) { networkDetailsLoaded = false; return; }
          var detailText = [details.adapter, details.ip4 ? 'IPv4 ' + details.ip4 : null, details.gateway ? 'GW ' + details.gateway : null, Array.isArray(details.dns) && details.dns.length ? 'DNS ' + details.dns.join(', ') : null, details.linkSpeed ? Math.round(details.linkSpeed) + ' Mbps' : null].filter(Boolean).join(' · ');
          setText(dom.netDetails, detailText || 'Adapter details unavailable');
        }).catch(function () { networkDetailsLoaded = false; });
      }
    }

    // Processes
    if (data.processes && data.processes.length) {
      lastProcessData = data.processes;
      var processQuery = dom.processFilter ? dom.processFilter.value.toLowerCase().trim() : '';
      var visibleProcesses = data.processes.filter(function (p) {
        return !processQuery || (String(p.name) + ' ' + String(p.pid == null ? '' : p.pid) + ' ' + String(p.path || '')).toLowerCase().indexOf(processQuery) !== -1;
      });
      var pSig = processQuery + '|' + visibleProcesses.map(function(p) { return p.name + ':' + p.pid + ':' + p.cpu + ':' + p.path; }).join('|');
      if (pSig !== procSignature) {
        procSignature = pSig;
        var phtml = '<div class="proc-row proc-header"><span></span><span>Process</span><span style="text-align:right">CPU</span><span style="text-align:right">MEM</span><span style="text-align:right">PID</span><span></span></div>';
        for (var p = 0; p < visibleProcesses.length; p++) {
          var proc = visibleProcesses[p];
          var colour = proc.cpu >= 10 ? 'var(--bad)' : proc.cpu >= 5 ? 'var(--warn)' : 'var(--fg-3)';
          phtml += '<div class="proc-row"><span class="proc-rank">' + (p + 1) + '</span>' +
            '<span class="proc-name">' + esc(proc.name) + '</span>' +
            '<span class="proc-cpu" style="color:' + colour + '">' + proc.cpu + '%</span>' +
            '<span class="proc-mem">' + proc.mem + '%</span>' +
            '<span class="proc-pid">' + (proc.pid == null ? '—' : proc.pid) + '</span>' +
            '<span class="proc-actions">' +
              (proc.pid != null ? '<button class="proc-action" data-action="pid" data-pid="' + proc.pid + '" title="Copy PID" aria-label="Copy PID">#</button>' : '') +
              (proc.path ? '<button class="proc-action" data-action="path" data-pid="' + proc.pid + '" data-path="' + esc(proc.path) + '" title="Copy executable path" aria-label="Copy executable path">⌘</button>' : '') +
              (proc.path ? '<button class="proc-action" data-action="location" data-pid="' + proc.pid + '" title="Open file location" aria-label="Open file location">↗</button>' : '') +
              (proc.pid != null && proc.pid > 4 ? '<button class="proc-action proc-action-danger" data-action="end" data-pid="' + proc.pid + '" title="End task" aria-label="End task">×</button>' : '') +
            '</span></div>';
        }
        if (!visibleProcesses.length) phtml += '<div class="proc-empty">No matching process</div>';
        dom.procList.innerHTML = phtml;
      }
    }

    // Battery
    if (data.battery) {
      dom.secBattery.style.display = '';
      setText(dom.batPct, data.battery.percent + '%');
      dom.batBar.className = 'progress-fill ' + loadClass(100 - data.battery.percent);
      setWidth(dom.batBar, data.battery.percent);
      setText(dom.batStatus, data.battery.charging ? 'Charging' : data.battery.acConnected ? 'On AC' : 'On battery');
    } else dom.secBattery.style.display = 'none';

    // OS
    if (data.os) {
      setText(dom.osDistro, data.os.distro + ' ' + data.os.release);
      if (data.os.uptime) setText(dom.osUptime, 'up ' + fmtUptime(data.os.uptime));
    }

    // Measured cost of the last cycle — the performance claim, on screen.
    if (data.metrics) {
      var m = data.metrics;
      if (m.fastMs != null) {
        setText(dom.perfReadout, m.fastMs.toFixed(1) + ' ms');
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
    applyTheme(theme);
    currentConfig.theme = theme;
    updateSettingsUI(currentConfig);
  });

  // LCD theme uses a separate stylesheet; enable/disable it based on the theme.
  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    var lcdLink = document.getElementById('lcd-theme-link');
    if (lcdLink) lcdLink.disabled = (theme !== 'lcd');
  }
  // Apply on load
  applyTheme(document.body.getAttribute('data-theme') || 'dark');
  api.on('layout-changed', function (layout) {
    document.body.setAttribute('data-layout', layout);
    currentConfig.layout = layout;
    updateSettingsUI(currentConfig);
  });
  api.on('display-topology-changed', function (displays) { renderDisplays(displays); });
  api.on('config-changed', function (cfg) {
    currentConfig = cfg;
    document.body.classList.toggle('compact', cfg.compactMode);
    applyTheme(cfg.theme);
    document.body.setAttribute('data-layout', cfg.layout || 'sidebar');
    applySectionVisibility(cfg);
    applyCollapsed(cfg);
    updateSettingsUI(cfg);
  });
  api.on('toggle-settings', function () { toggleSettings(); });
  api.on('toggle-palette', openPalette);
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
    if (info.displays) renderDisplays(info.displays);
  }).catch(function () { /* version is cosmetic */ });

  api.getSystemData().then(function (data) {
    if (data.config) {
      currentConfig = data.config;
      applySectionVisibility(data.config);
      applyCollapsed(data.config);
      updateSettingsUI(data.config);
    }
    scheduleUpdate(data);
  }).catch(function () { /* the interval will retry */ });

  refreshProfiles();

  // The Shell card is injected by shell/panel.js, so decorate again once it is
  // in the DOM.
  setTimeout(function () { applyCollapsed(currentConfig); }, 0);
})();
