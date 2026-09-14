// ═══════════════════════════════════════════════════════
// SysGlance — Shell panel (renderer side)
//
// Deliberately self-contained: it builds its own DOM, styles itself through
// panel.css and talks to the main process over the shell:* channels defined in
// src/shell/ipc.js. index.html therefore only needs two lines
//   <link rel="stylesheet" href="shell/panel.css">
//   <script src="shell/panel.js"></script>
// which keeps the shared UI files easy to refactor without losing this panel.
//
// It runs sandboxed (contextIsolation), so everything goes through
// `window.sysglance.shell.*` — no require(), no ipcRenderer.
//
// Scope: SysGlance *configures* the shell (position, auto-hide, dark mode,
// accent, wallpaper). The resident taskbar vibrancy effect belongs to the
// sibling app OpenClaw Widget — PRODUCT.md rules 1 and 2 — so this panel has
// no blur controls and instead says where that effect lives, with a link.
//
// The panel hides itself when the main process reports the platform has no
// shell support (anything that is not Windows / WSL).
// ═══════════════════════════════════════════════════════

(function () {
  'use strict';

  if (document.getElementById('sec-shell')) return; // already injected

  var api = window.sysglance;
  if (!api || !api.shell) return;

  var POS_INDEX = { left: 0, top: 1, right: 2, bottom: 3 };

  var HTML =
    '<div class="section" id="sec-shell">' +
      '<div class="section-header">' +
        '<span class="section-icon"><svg class="ic" viewBox="0 0 24 24"><use href="#i-shell"/></svg></span>' +
        '<span class="section-title">Shell</span>' +
        '<span class="section-value" id="shell-summary">\u2014</span>' +
        '<button class="status-btn shell-refresh" id="shell-refresh" title="Re-read Windows state">' +
          '<svg class="ic" viewBox="0 0 24 24"><use href="#i-refresh"/></svg></button>' +
      '</div>' +

      '<div class="shell-group">' +
        '<div class="shell-label">Taskbar position</div>' +
        '<div class="shell-seg" id="shell-position">' +
          '<button class="shell-seg-btn" data-pos="left">Left</button>' +
          '<button class="shell-seg-btn" data-pos="top">Top</button>' +
          '<button class="shell-seg-btn" data-pos="right">Right</button>' +
          '<button class="shell-seg-btn" data-pos="bottom">Bottom</button>' +
        '</div>' +
        '<div class="shell-actions">' +
          '<label class="shell-toggle"><input type="checkbox" id="shell-autohide"><span>Auto-hide</span></label>' +
          '<label class="shell-toggle"><input type="checkbox" id="shell-dark"><span>Dark mode</span></label>' +
        '</div>' +
      '</div>' +

      '<div class="shell-group">' +
        '<div class="shell-label">Accent <span class="shell-swatch" id="shell-swatch"></span>' +
          '<span id="shell-accent-hex" class="info-small">—</span></div>' +
        '<div class="shell-actions">' +
          '<button class="shell-btn" id="shell-accent-from-wallpaper">From wallpaper</button>' +
          '<button class="shell-btn primary" id="shell-accent-auto">Auto accent</button>' +
        '</div>' +
      '</div>' +

      '<div class="shell-group">' +
        '<div class="shell-label">Wallpaper</div>' +
        '<div class="shell-actions">' +
          '<input type="text" id="shell-wallpaper-path" class="shell-input" placeholder="C:\\Users\\you\\Pictures\\wallpaper.png" spellcheck="false">' +
          '<button class="shell-btn tight" id="shell-wallpaper-browse" title="Choose a file">…</button>' +
          '<button class="shell-btn tight" id="shell-wallpaper-apply">Set</button>' +
        '</div>' +
      '</div>' +

      // Not a control: an ownership statement. Vibrancy is the sibling app's job.
      '<div class="shell-widget" id="shell-widget">' +
        '<span class="shell-widget-icon"><svg class="ic" viewBox="0 0 24 24"><use href="#i-gpu"/></svg></span>' +
        '<span class="shell-widget-text">Taskbar vibrancy (blur / acrylic) is kept alive by ' +
          '<strong id="shell-widget-name">OpenClaw Widget</strong>, not by SysGlance \u2014 one process owns that effect.' +
        '</span>' +
        '<button class="shell-mini-btn" id="shell-widget-open">Open repository</button>' +
      '</div>' +

      '<div class="shell-note" id="shell-message" style="display:none"></div>' +
    '</div>';

  function inject() {
    var content = document.getElementById('content');
    if (!content) return false;
    var holder = document.createElement('div');
    holder.innerHTML = HTML;
    var section = holder.firstElementChild;
    var footer = document.getElementById('sec-os');
    if (footer) content.insertBefore(section, footer);
    else content.appendChild(section);
    return true;
  }

  if (!inject()) return;

  var el = {
    section: document.getElementById('sec-shell'),
    summary: document.getElementById('shell-summary'),
    refresh: document.getElementById('shell-refresh'),
    position: document.getElementById('shell-position'),
    autohide: document.getElementById('shell-autohide'),
    dark: document.getElementById('shell-dark'),
    swatch: document.getElementById('shell-swatch'),
    accentHex: document.getElementById('shell-accent-hex'),
    accentFromWallpaper: document.getElementById('shell-accent-from-wallpaper'),
    accentAuto: document.getElementById('shell-accent-auto'),
    wallpaperPath: document.getElementById('shell-wallpaper-path'),
    wallpaperBrowse: document.getElementById('shell-wallpaper-browse'),
    wallpaperApply: document.getElementById('shell-wallpaper-apply'),
    widgetName: document.getElementById('shell-widget-name'),
    widgetOpen: document.getElementById('shell-widget-open'),
    message: document.getElementById('shell-message')
  };

  var RESTART_BTN = ' <button class="shell-mini-btn" id="shell-restart-explorer">Restart Explorer</button>';

  function say(text, kind) {
    if (!text) { el.message.style.display = 'none'; el.message.innerHTML = ''; return; }
    el.message.className = 'shell-note' + (kind ? ' ' + kind : '');
    el.message.innerHTML = text;
    el.message.style.display = '';
    // The banner carries the only affordance for applying taskbar changes, so
    // surface it whenever the user tries to act without an explorer restart.
    if (kind === 'warn' && !document.getElementById('shell-restart-explorer')) {
      el.message.innerHTML += RESTART_BTN;
    }
  }

  // ── rendering ──────────────────────────────────────────
  function render(st) {
    if (!st || st.ok === false || st.supported === false) {
      el.section.style.display = 'none';
      el.section.dataset.supported = 'false';
      return;
    }
    el.section.style.display = '';
    el.section.dataset.supported = 'true';

    var tb = st.taskbar || {};
    var theme = st.theme || {};
    var cfg = st.config || {};

    if (tb.ok === false) {
      el.summary.textContent = 'n/a';
    } else {
      el.summary.textContent = (tb.position || '—') + (tb.autoHide ? ' ·hide' : '');
    }

    var btns = el.position.querySelectorAll('.shell-seg-btn');
    for (var i = 0; i < btns.length; i++) {
      var idx = POS_INDEX[btns[i].dataset.pos];
      btns[i].classList.toggle('active', tb.ok !== false && idx === tb.positionIndex);
    }

    el.autohide.checked = !!tb.autoHide;
    el.dark.checked = theme.ok ? theme.dark === true : cfg.darkMode !== false;

    var accent = cfg.accent || null;
    var hex = accent && accent.hex ? accent.hex : (st.accent && st.accent.hex ? st.accent.hex : null);
    el.swatch.style.background = hex || 'transparent';
    el.accentHex.textContent = hex || '—';

    if (document.activeElement !== el.wallpaperPath) {
      el.wallpaperPath.value = cfg.wallpaperPath || (st.wallpaper && st.wallpaper.path) || '';
    }

    if (st.widget && st.widget.name) el.widgetName.textContent = st.widget.name;

    if (tb.restartRequired) {
      say('Explorer restart required for position / auto-hide to apply.', 'warn');
    }
  }

  async function call(channel, arg) {
    try {
      var payload = await api.shell[channel](arg);
      if (payload && payload.state) render(payload.state);
      return payload ? payload.result : null;
    } catch (err) {
      say('✖ ' + err.message, 'err');
      return null;
    }
  }

  async function refresh() {
    try {
      render(await api.shell.getState());
    } catch (err) {
      el.section.style.display = 'none'; // no shell support here
      el.section.dataset.supported = 'false';
    }
  }

  // ── wiring ─────────────────────────────────────────────
  el.refresh.addEventListener('click', refresh);

  el.position.addEventListener('click', async function (ev) {
    var btn = ev.target.closest ? ev.target.closest('.shell-seg-btn') : null;
    if (!btn) return;
    say('Applying…');
    var r = await call('setPosition', btn.dataset.pos);
    if (!r) return;
    if (r.ok === false) return say('✖ ' + r.error, 'err');
    say(r.changed
      ? 'Position → ' + r.position + '. Explorer restart required.'
      : 'Position is already ' + r.position + '.', r.changed ? 'warn' : 'ok');
  });

  el.autohide.addEventListener('change', async function () {
    var on = el.autohide.checked;
    say('Applying…');
    var r = await call('setAutoHide', on);
    if (!r) return;
    if (r.ok === false) return say('✖ ' + r.error, 'err');
    say(r.changed
      ? 'Auto-hide ' + (on ? 'on' : 'off') + '. Explorer restart required.'
      : 'Auto-hide already ' + (on ? 'on' : 'off') + '.', r.changed ? 'warn' : 'ok');
  });

  el.dark.addEventListener('change', async function () {
    var on = el.dark.checked;
    say('Applying…');
    var r = await call('setDark', on);
    if (!r) return;
    if (r.ok === false) return say('✖ ' + r.error, 'err');
    say((on ? 'Dark' : 'Light') + ' mode set. Already-running apps may need a re-login.', 'ok');
  });

  el.accentFromWallpaper.addEventListener('click', async function () {
    say('Sampling the wallpaper…');
    var r = await call('accentFromWallpaper');
    if (!r) return;
    if (r.ok === false) return say('✖ ' + r.error, 'err');
    say('Wallpaper accent: ' + r.hex + ' (r' + r.r + ' g' + r.g + ' b' + r.b + ') from ' + r.wallpaperPath, 'ok');
  });

  el.accentAuto.addEventListener('click', async function () {
    say('Applying accent from wallpaper…');
    var r = await call('accentAuto');
    if (!r) return;
    if (r.ok === false) return say('✖ ' + r.error, 'err');
    say('Accent ' + r.derived.hex + ' written to DWM + ColorPrevalence=1.', 'ok');
  });

  el.wallpaperBrowse.addEventListener('click', async function () {
    var r = await call('pickWallpaper');
    if (!r || r.ok === false) return;
    el.wallpaperPath.value = r.path;
    say('Selected ' + r.base + '. Press Set to apply.', 'ok');
  });

  el.wallpaperApply.addEventListener('click', async function () {
    var p = el.wallpaperPath.value.trim();
    if (!p) return say('✖ Enter a wallpaper path first.', 'err');
    say('Applying wallpaper…');
    var r = await call('applyWallpaper', p);
    if (!r) return;
    if (r.ok === false) return say('✖ ' + r.error, 'err');
    say('Wallpaper applied (registry + SystemParametersInfo).', 'ok');
  });

  el.widgetOpen.addEventListener('click', async function () {
    var r = await api.shell.openWidget();
    if (r && r.ok === false) say('✖ ' + r.error, 'err');
    else say('Opened the ' + el.widgetName.textContent + ' repository.', 'ok');
  });

  el.message.addEventListener('click', async function (ev) {
    if (!ev.target || ev.target.id !== 'shell-restart-explorer') return;
    say('Restarting explorer.exe…');
    var r = await call('restartExplorer');
    if (!r) return;
    say(r.ok ? 'Explorer restarted. Changes applied.' : '✖ ' + r.error, r.ok ? 'ok' : 'err');
  });

  // The main process broadcasts every persisted shell change (tray actions
  // included), so the panel stays in sync without polling.
  api.on('shell-config-changed', function () { refresh(); });

  refresh();
})();
