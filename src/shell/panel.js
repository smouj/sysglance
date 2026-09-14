// ═══════════════════════════════════════════════════════
// SysGlance — Windows shell panel (renderer side)
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
// Safety: every value shown here comes from the main process, and every action
// is a named operation with a narrow argument. The wallpaper thumbnail is a
// downscaled data URL produced by the main process after validating the path;
// the renderer never receives a file handle or a filesystem path it can choose.
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
  var POS_NAME = ['left', 'top', 'right', 'bottom'];

  var HTML =
    '<div class="section" id="sec-shell">' +
      '<div class="section-header">' +
        '<span class="section-icon"><svg class="ic" viewBox="0 0 24 24"><use href="#i-shell"/></svg></span>' +
        '<span class="section-title">Windows shell</span>' +
        '<span class="section-value" id="shell-summary">\u2014</span>' +
        '<button class="status-btn shell-refresh" id="shell-refresh" title="Re-read Windows state">' +
          '<svg class="ic" viewBox="0 0 24 24"><use href="#i-refresh"/></svg></button>' +
      '</div>' +

      // A live picture of where the bar sits beats four abstract buttons.
      '<div class="shell-group">' +
        '<div class="shell-label"><span>Taskbar position</span><span id="shell-pos-name" class="label-value"></span></div>' +
        '<div class="tb-preview" id="shell-tb-preview" data-pos="bottom" aria-hidden="true"></div>' +
        '<div class="shell-seg" id="shell-position" role="group" aria-label="Taskbar position">' +
          '<button class="shell-seg-btn" data-pos="left">Left</button>' +
          '<button class="shell-seg-btn" data-pos="top">Top</button>' +
          '<button class="shell-seg-btn" data-pos="right">Right</button>' +
          '<button class="shell-seg-btn" data-pos="bottom">Bottom</button>' +
        '</div>' +
      '</div>' +

      '<div class="shell-group">' +
        '<div class="shell-toggles">' +
          '<label class="shell-toggle"><input type="checkbox" id="shell-autohide"><span>Auto-hide</span></label>' +
          '<label class="shell-toggle"><input type="checkbox" id="shell-dark"><span>Dark mode</span></label>' +
        '</div>' +
      '</div>' +

      '<div class="shell-group">' +
        '<div class="shell-label">' +
          '<span class="shell-accent-label">Accent <span class="shell-swatch" id="shell-swatch"></span></span>' +
          '<span id="shell-accent-hex" class="label-value">\u2014</span>' +
        '</div>' +
        '<div class="shell-actions">' +
          '<button class="shell-btn" id="shell-accent-from-wallpaper">From wallpaper</button>' +
          '<button class="shell-btn primary" id="shell-accent-auto">Auto accent</button>' +
        '</div>' +
      '</div>' +

      '<div class="shell-group">' +
        '<div class="shell-label"><span>Wallpaper</span></div>' +
        '<div class="shell-wallpaper">' +
          '<div class="shell-thumb" id="shell-thumb"><span class="shell-thumb-empty">no preview</span></div>' +
          '<div class="shell-wallpaper-fields">' +
            '<input type="text" id="shell-wallpaper-path" class="shell-input" placeholder="C:\\Users\\you\\Pictures\\wallpaper.png" spellcheck="false">' +
            '<div class="shell-actions">' +
              '<button class="shell-btn tight" id="shell-wallpaper-browse">Browse\u2026</button>' +
              '<button class="shell-btn tight primary" id="shell-wallpaper-apply">Apply</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Not a control: an ownership statement. Vibrancy is the sibling app's job.
      '<div class="shell-widget" id="shell-widget">' +
        '<span class="shell-widget-icon"><svg class="ic" viewBox="0 0 24 24"><use href="#i-sparkle"/></svg></span>' +
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
    posName: document.getElementById('shell-pos-name'),
    tbPreview: document.getElementById('shell-tb-preview'),
    position: document.getElementById('shell-position'),
    autohide: document.getElementById('shell-autohide'),
    dark: document.getElementById('shell-dark'),
    swatch: document.getElementById('shell-swatch'),
    accentHex: document.getElementById('shell-accent-hex'),
    accentFromWallpaper: document.getElementById('shell-accent-from-wallpaper'),
    accentAuto: document.getElementById('shell-accent-auto'),
    thumb: document.getElementById('shell-thumb'),
    wallpaperPath: document.getElementById('shell-wallpaper-path'),
    wallpaperBrowse: document.getElementById('shell-wallpaper-browse'),
    wallpaperApply: document.getElementById('shell-wallpaper-apply'),
    widgetName: document.getElementById('shell-widget-name'),
    widgetOpen: document.getElementById('shell-widget-open'),
    message: document.getElementById('shell-message')
  };

  var RESTART_BTN = ' <button class="shell-mini-btn" id="shell-restart-explorer">Restart Explorer</button>';
  var thumbPath = null;   // thumbnail cache key: the path we last rendered

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

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
    var pos = POS_NAME[tb.positionIndex] || 'bottom';

    el.summary.textContent = tb.ok === false ? 'n/a' : (tb.position || '\u2014') + (tb.autoHide ? ' \u00b7 hide' : '');
    el.posName.textContent = tb.ok === false ? '' : pos;
    el.tbPreview.dataset.pos = pos;

    var btns = el.position.querySelectorAll('.shell-seg-btn');
    for (var i = 0; i < btns.length; i++) {
      var active = tb.ok !== false && POS_INDEX[btns[i].dataset.pos] === tb.positionIndex;
      btns[i].classList.toggle('active', active);
      btns[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    el.autohide.checked = !!tb.autoHide;
    el.dark.checked = theme.ok ? theme.dark === true : cfg.darkMode !== false;

    var accent = cfg.accent || null;
    var hex = accent && accent.hex ? accent.hex : (st.accent && st.accent.hex ? st.accent.hex : null);
    el.swatch.style.background = hex || 'transparent';
    el.swatch.classList.toggle('is-set', !!hex);
    el.accentHex.textContent = hex || '\u2014';

    var path = cfg.wallpaperPath || (st.wallpaper && st.wallpaper.path) || '';
    if (document.activeElement !== el.wallpaperPath) el.wallpaperPath.value = path;
    if (path !== thumbPath) loadThumb(path);

    if (st.widget && st.widget.name) el.widgetName.textContent = st.widget.name;

    if (tb.restartRequired) {
      say('Explorer restart required for position / auto-hide to apply.', 'warn');
    }
  }

  /**
   * The thumbnail is produced by the main process (validated path, downscaled
   * data URL) and cached here per path — re-decoding on every state refresh
   * would be pointless work for an image that only changes when the user picks
   * a new one.
   */
  function loadThumb(path) {
    thumbPath = path;
    if (!path) {
      el.thumb.style.backgroundImage = '';
      el.thumb.innerHTML = '<span class="shell-thumb-empty">no wallpaper set</span>';
      el.thumb.classList.remove('is-set');
      return;
    }
    el.thumb.innerHTML = '<span class="shell-thumb-empty">loading\u2026</span>';
    el.thumb.classList.remove('is-set');
    api.shell.wallpaperPreview(path).then(function (payload) {
      var res = payload && payload.result ? payload.result : payload;
      if (!res || res.ok === false) {
        el.thumb.style.backgroundImage = '';
        el.thumb.innerHTML = '<span class="shell-thumb-empty">preview unavailable</span>';
        return;
      }
      el.thumb.innerHTML = '';
      el.thumb.style.backgroundImage = 'url("' + res.dataUrl + '")';
      el.thumb.classList.add('is-set');
      el.thumb.title = path + ' (' + res.source.width + '\u00d7' + res.source.height + ')';
    }).catch(function () {
      el.thumb.innerHTML = '<span class="shell-thumb-empty">preview unavailable</span>';
    });
  }

  async function call(channel, arg) {
    try {
      var payload = await api.shell[channel](arg);
      if (payload && payload.state) render(payload.state);
      return payload ? payload.result : null;
    } catch (err) {
      say('\u2716 ' + err.message, 'err');
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
    say('Applying\u2026');
    var r = await call('setPosition', btn.dataset.pos);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say(r.changed
      ? 'Position \u2192 ' + r.position + '. Explorer restart required.'
      : 'Position is already ' + r.position + '.', r.changed ? 'warn' : 'ok');
  });

  el.autohide.addEventListener('change', async function () {
    var on = el.autohide.checked;
    say('Applying\u2026');
    var r = await call('setAutoHide', on);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say(r.changed
      ? 'Auto-hide ' + (on ? 'on' : 'off') + '. Explorer restart required.'
      : 'Auto-hide already ' + (on ? 'on' : 'off') + '.', r.changed ? 'warn' : 'ok');
  });

  el.dark.addEventListener('change', async function () {
    var on = el.dark.checked;
    say('Applying\u2026');
    var r = await call('setDark', on);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say((on ? 'Dark' : 'Light') + ' mode set. Already-running apps may need a re-login.', 'ok');
  });

  el.accentFromWallpaper.addEventListener('click', async function () {
    say('Sampling the wallpaper\u2026');
    var r = await call('accentFromWallpaper');
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say('Wallpaper accent: ' + r.hex + ' (r' + r.r + ' g' + r.g + ' b' + r.b + ')', 'ok');
  });

  el.accentAuto.addEventListener('click', async function () {
    say('Applying accent from wallpaper\u2026');
    var r = await call('accentAuto');
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say('Accent ' + r.derived.hex + ' written to DWM + ColorPrevalence=1.', 'ok');
  });

  el.wallpaperBrowse.addEventListener('click', async function () {
    var r = await call('pickWallpaper');
    if (!r || r.ok === false) return;
    el.wallpaperPath.value = r.path;
    say('Selected ' + esc(r.base) + '. Press Apply.', 'ok');
  });

  el.wallpaperApply.addEventListener('click', async function () {
    var p = el.wallpaperPath.value.trim();
    if (!p) return say('\u2716 Enter a wallpaper path first.', 'err');
    say('Applying\u2026');
    var r = await call('applyWallpaper', p);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say(r.systemParametersInfo === false
      ? 'Registry written, but the native helper is not built \u2014 the wallpaper appears at the next logon.'
      : 'Wallpaper applied.', r.systemParametersInfo === false ? 'warn' : 'ok');
  });

  el.wallpaperPath.addEventListener('change', function () { loadThumb(el.wallpaperPath.value.trim()); });

  el.widgetOpen.addEventListener('click', async function () {
    var r = await api.shell.openWidget();
    if (r && r.ok === false) say('\u2716 ' + r.error, 'err');
    else say('Opened the ' + esc(el.widgetName.textContent) + ' repository.', 'ok');
  });

  el.message.addEventListener('click', async function (ev) {
    if (!ev.target || ev.target.id !== 'shell-restart-explorer') return;
    say('Restarting explorer.exe\u2026');
    var r = await call('restartExplorer');
    if (!r) return;
    say(r.ok ? 'Explorer restarted. Changes applied.' : '\u2716 ' + r.error, r.ok ? 'ok' : 'err');
  });

  // The main process broadcasts every persisted shell change (tray actions
  // included), so the panel stays in sync without polling.
  api.on('shell-config-changed', function () { refresh(); });

  refresh();
})();
