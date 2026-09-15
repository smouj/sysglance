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
// accent, wallpaper, wallpaper gallery, folder customization, Start menu).
// The resident taskbar vibrancy effect belongs to the sibling app OpenClaw
// Widget — PRODUCT.md rules 1 and 2 — so this panel has no blur controls and
// instead says where that effect lives, with a link.
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

  // Accent colour presets for the custom colour picker
  var ACCENT_PRESETS = [
    '#0078d4', '#0099bc', '#7a7574', '#767676',
    '#ff8c00', '#e81123', '#d13438', '#c30052',
    '#881798', '#744da9', '#b146c2', '#00b7c3',
    '#038387', '#00cc6a', '#10893e', '#498205'
  ];

  var HTML =
    '<div class="section" id="sec-shell">' +
      '<div class="section-header">' +
        '<span class="section-icon"><svg class="ic" viewBox="0 0 24 24"><use href="#i-shell"/></svg></span>' +
        '<span class="section-title">Windows shell</span>' +
        '<span class="section-value" id="shell-summary">\u2014</span>' +
        '<button class="status-btn shell-refresh" id="shell-refresh" title="Re-read Windows state">' +
          '<svg class="ic" viewBox="0 0 24 24"><use href="#i-refresh"/></svg></button>' +
      '</div>' +

      // ── Desktop preview (live wallpaper + taskbar bar) ──
      '<div class="shell-group">' +
        '<div class="shell-label"><span>Desktop preview</span></div>' +
        '<div class="shell-desktop-preview" id="shell-desktop-preview" data-pos="bottom">' +
          '<div class="tb-bar"></div>' +
          '<span class="preview-label">desktop</span>' +
        '</div>' +
      '</div>' +

      // ── Taskbar position ──
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

      // ── Accent colour (enhanced with picker) ──
      '<div class="shell-group">' +
        '<div class="shell-label">' +
          '<span class="shell-accent-label">Accent <span class="shell-swatch" id="shell-swatch"></span></span>' +
          '<span id="shell-accent-hex" class="label-value">\u2014</span>' +
        '</div>' +
        '<div class="shell-actions">' +
          '<button class="shell-btn" id="shell-accent-from-wallpaper">From wallpaper</button>' +
          '<button class="shell-btn primary" id="shell-accent-auto">Auto accent</button>' +
        '</div>' +
        '<div class="shell-accent-picker" id="shell-accent-picker">' +
          '<input type="color" id="shell-accent-color" class="shell-color-input" title="Pick a custom accent colour">' +
          '<input type="text" id="shell-accent-hex-input" class="shell-hex-input" placeholder="#0078d4" maxlength="7" spellcheck="false">' +
          '<button class="shell-btn tight" id="shell-accent-apply-hex">Set</button>' +
          '<div class="shell-color-presets" id="shell-accent-presets"></div>' +
        '</div>' +
      '</div>' +

      // ── Wallpaper (enhanced with gallery) ──
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
        '<div class="shell-actions" style="margin-top:5px">' +
          '<button class="shell-btn" id="shell-wallpaper-gallery-btn">Gallery</button>' +
          '<button class="shell-btn" id="shell-wallpaper-open-folder">Open folder</button>' +
        '</div>' +
        '<div id="shell-gallery-container" style="display:none">' +
          '<div class="shell-gallery" id="shell-gallery"></div>' +
        '</div>' +
      '</div>' +

      // ── Start menu ──
      '<div class="shell-group">' +
        '<div class="shell-section-header" id="shell-start-header">' +
          '<span class="shell-label" style="margin-bottom:0"><span>Start menu</span></span>' +
          '<span class="shell-chevron">\u25B6</span>' +
        '</div>' +
        '<input type="checkbox" class="shell-section-toggle" id="shell-start-toggle">' +
        '<div class="shell-collapse" id="shell-start-collapse">' +
          '<div class="shell-start-toggles">' +
            '<label class="shell-toggle"><input type="checkbox" id="shell-start-recent"><span>Show recent apps</span></label>' +
            '<label class="shell-toggle"><input type="checkbox" id="shell-start-suggestions"><span>Show suggestions</span></label>' +
            '<label class="shell-toggle"><input type="checkbox" id="shell-start-fullscreen"><span>Full-screen Start</span></label>' +
          '</div>' +
          '<div class="shell-start-action">' +
            '<button class="shell-btn" id="shell-start-open-settings">Open personalization</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ── Folder customization ──
      '<div class="shell-group">' +
        '<div class="shell-section-header" id="shell-folder-header">' +
          '<span class="shell-label" style="margin-bottom:0"><span>Folder icons</span></span>' +
          '<span class="shell-chevron">\u25B6</span>' +
        '</div>' +
        '<input type="checkbox" class="shell-section-toggle" id="shell-folder-toggle">' +
        '<div class="shell-collapse" id="shell-folder-collapse">' +
          '<div class="shell-folder-list" id="shell-folder-list"></div>' +
        '</div>' +
      '</div>' +

      // ── Vibrancy ownership note ──
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
    // Desktop preview
    desktopPreview: document.getElementById('shell-desktop-preview'),
    // Taskbar position
    posName: document.getElementById('shell-pos-name'),
    tbPreview: document.getElementById('shell-tb-preview'),
    position: document.getElementById('shell-position'),
    autohide: document.getElementById('shell-autohide'),
    dark: document.getElementById('shell-dark'),
    // Accent
    swatch: document.getElementById('shell-swatch'),
    accentHex: document.getElementById('shell-accent-hex'),
    accentFromWallpaper: document.getElementById('shell-accent-from-wallpaper'),
    accentAuto: document.getElementById('shell-accent-auto'),
    accentColor: document.getElementById('shell-accent-color'),
    accentHexInput: document.getElementById('shell-accent-hex-input'),
    accentApplyHex: document.getElementById('shell-accent-apply-hex'),
    accentPresets: document.getElementById('shell-accent-presets'),
    // Wallpaper
    thumb: document.getElementById('shell-thumb'),
    wallpaperPath: document.getElementById('shell-wallpaper-path'),
    wallpaperBrowse: document.getElementById('shell-wallpaper-browse'),
    wallpaperApply: document.getElementById('shell-wallpaper-apply'),
    wallpaperGalleryBtn: document.getElementById('shell-wallpaper-gallery-btn'),
    wallpaperOpenFolder: document.getElementById('shell-wallpaper-open-folder'),
    galleryContainer: document.getElementById('shell-gallery-container'),
    gallery: document.getElementById('shell-gallery'),
    // Start menu
    startHeader: document.getElementById('shell-start-header'),
    startToggle: document.getElementById('shell-start-toggle'),
    startRecent: document.getElementById('shell-start-recent'),
    startSuggestions: document.getElementById('shell-start-suggestions'),
    startFullscreen: document.getElementById('shell-start-fullscreen'),
    startOpenSettings: document.getElementById('shell-start-open-settings'),
    // Folder customization
    folderHeader: document.getElementById('shell-folder-header'),
    folderToggle: document.getElementById('shell-folder-toggle'),
    folderList: document.getElementById('shell-folder-list'),
    // Widget
    widgetName: document.getElementById('shell-widget-name'),
    widgetOpen: document.getElementById('shell-widget-open'),
    message: document.getElementById('shell-message')
  };

  var RESTART_BTN = ' <button class="shell-mini-btn" id="shell-restart-explorer">Restart Explorer</button>';
  var thumbPath = null;
  var galleryVisible = false;
  var galleryLoaded = false;
  var desktopPreviewWallpaper = null;

  function say(text, kind) {
    if (!text) { el.message.style.display = 'none'; el.message.innerHTML = ''; return; }
    el.message.className = 'shell-note' + (kind ? ' ' + kind : '');
    el.message.innerHTML = text;
    el.message.style.display = '';
    if (kind === 'warn' && !document.getElementById('shell-restart-explorer')) {
      el.message.innerHTML += RESTART_BTN;
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Collapsible sections ────────────────────────────────
  function wireToggle(headerId, toggleId) {
    var header = document.getElementById(headerId);
    var toggle = document.getElementById(toggleId);
    if (!header || !toggle) return;
    header.addEventListener('click', function () {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change'));
    });
  }
  wireToggle('shell-start-header', 'shell-start-toggle');
  wireToggle('shell-folder-header', 'shell-folder-toggle');

  // ── Accent presets ──────────────────────────────────────
  function buildAccentPresets() {
    var container = el.accentPresets;
    for (var i = 0; i < ACCENT_PRESETS.length; i++) {
      var dot = document.createElement('span');
      dot.className = 'shell-color-dot';
      dot.style.background = ACCENT_PRESETS[i];
      dot.dataset.hex = ACCENT_PRESETS[i];
      dot.title = ACCENT_PRESETS[i];
      dot.addEventListener('click', (function (hex) {
        return function () { applyAccentHex(hex); };
      })(ACCENT_PRESETS[i]));
      container.appendChild(dot);
    }
  }
  buildAccentPresets();

  function updateAccentDotActive(hex) {
    var dots = el.accentPresets.querySelectorAll('.shell-color-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-active', dots[i].dataset.hex.toLowerCase() === (hex || '').toLowerCase());
    }
  }

  async function applyAccentHex(hex) {
    say('Applying accent\u2026');
    el.accentHexInput.value = hex;
    el.accentColor.value = hex;
    var r = await call('accentSetHex', hex);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say('Accent set to ' + hex + '.', 'ok');
    refresh();
  }

  // ── Rendering ──────────────────────────────────────────
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
    el.desktopPreview.dataset.pos = pos;

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
    updateAccentDotActive(hex);

    var path = cfg.wallpaperPath || (st.wallpaper && st.wallpaper.path) || '';
    if (document.activeElement !== el.wallpaperPath) el.wallpaperPath.value = path;
    if (path !== thumbPath) loadThumb(path);

    // Desktop preview: use wallpaper thumbnail as background
    if (path && path !== desktopPreviewWallpaper) {
      desktopPreviewWallpaper = path;
      api.shell.wallpaperPreview(path).then(function (payload) {
        var res = payload && payload.result ? payload.result : payload;
        if (res && res.ok && res.dataUrl) {
          el.desktopPreview.style.backgroundImage = 'url("' + res.dataUrl + '")';
        }
      }).catch(function () {});
    } else if (!path) {
      el.desktopPreview.style.backgroundImage = '';
      desktopPreviewWallpaper = null;
    }

    // Start menu state
    if (st.startMenu && st.startMenu.ok) {
      el.startRecent.checked = st.startMenu.showRecentApps;
      el.startSuggestions.checked = st.startMenu.showSuggestions;
      el.startFullscreen.checked = st.startMenu.fullScreenStart;
    }

    // Special folders
    if (st.specialFolders && st.specialFolders.ok) {
      renderFolderList(st.specialFolders.folders);
    }

    if (st.widget && st.widget.name) el.widgetName.textContent = st.widget.name;

    if (tb.restartRequired) {
      say('Explorer restart required for position / auto-hide to apply.', 'warn');
    }
  }

  // ── Folder list ─────────────────────────────────────────
  var FOLDER_ICONS = { Desktop: '\uD83D\uDDA5', Documents: '\uD83D\uDCC4', Downloads: '\u2B07', Pictures: '\uD83D\uDCF7', Videos: '\uD83C\uDFA5', Music: '\uD83C\uDFB5' };

  function renderFolderList(folders) {
    if (!folders || !folders.length) {
      el.folderList.innerHTML = '<div class="shell-gallery-empty">No special folders found</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < folders.length; i++) {
      var f = folders[i];
      var icon = FOLDER_ICONS[f.id] || '\uD83D\uDCC1';
      html += '<div class="shell-folder-item" data-path="' + esc(f.path) + '" data-id="' + esc(f.id) + '">' +
        '<span class="folder-icon">' + icon + '</span>' +
        '<span class="folder-name">' + esc(f.name) + '</span>' +
        '<span class="folder-actions">' +
          (f.exists ? '<button class="shell-mini-btn folder-customize" data-path="' + esc(f.path) + '" title="Customize icon">Customize</button>' : '') +
        '</span>' +
      '</div>';
    }
    el.folderList.innerHTML = html;
  }

  // ── Wallpaper gallery ──────────────────────────────────
  async function loadGallery() {
    el.gallery.innerHTML = '<div class="shell-gallery-empty">Loading\u2026</div>';
    try {
      var res = await api.shell.listWallpapers();
      if (!res || !res.ok) {
        el.gallery.innerHTML = '<div class="shell-gallery-empty">' + esc((res && res.error) || 'Could not read wallpaper folder') + '</div>';
        return;
      }
      if (!res.files || res.files.length === 0) {
        el.gallery.innerHTML = '<div class="shell-gallery-empty">No wallpapers found in<br><small>' + esc(res.dir) + '</small></div>';
        return;
      }
      var html = '';
      for (var i = 0; i < res.files.length; i++) {
        var f = res.files[i];
        html += '<div class="shell-gallery-item" data-path="' + esc(f.path) + '" data-name="' + esc(f.name) + '" data-animated="' + (f.isAnimated ? '1' : '0') + '" title="' + esc(f.name) + '">';
        if (f.isAnimated) {
          html += '<div style="width:100%;height:100%;background:var(--bg-inset);display:grid;place-items:center;font-size:9px;color:var(--fg-4)">' + esc(f.name) + '</div>';
          html += '<span class="anim-badge">Video</span>';
        }
        // Thumbnails loaded lazily below
        html += '</div>';
      }
      el.gallery.innerHTML = html;

      // Load thumbnails for static wallpapers
      var items = el.gallery.querySelectorAll('.shell-gallery-item:not([data-animated="1"])');
      for (var j = 0; j < items.length; j++) {
        (function (item) {
          var p = item.dataset.path;
          api.shell.wallpaperGalleryPreview(p).then(function (payload) {
            var r = payload && payload.result ? payload.result : payload;
            if (r && r.ok && r.dataUrl) {
              var img = document.createElement('img');
              img.src = r.dataUrl;
              img.alt = item.dataset.name;
              item.insertBefore(img, item.firstChild);
            }
          }).catch(function () {});
        })(items[j]);
      }

      // Click to apply
      el.gallery.querySelectorAll('.shell-gallery-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var p = item.dataset.path;
          var isAnimated = item.dataset.animated === '1';
          if (isAnimated) {
            say('Animated wallpapers (.webm/.mp4) require a third-party tool (e.g. Lively Wallpaper). Opening the folder so you can set it from there.', 'warn');
            api.shell.openWallpaperFolder().catch(function () {});
            return;
          }
          el.wallpaperPath.value = p;
          loadThumb(p);
          applyWallpaperPath(p);
        });
      });

      galleryLoaded = true;
    } catch (err) {
      el.gallery.innerHTML = '<div class="shell-gallery-empty">Error loading gallery</div>';
    }
  }

  async function applyWallpaperPath(p) {
    if (!p) return say('\u2716 Enter a wallpaper path first.', 'err');
    say('Applying\u2026');
    var r = await call('applyWallpaper', p);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say(r.systemParametersInfo === false
      ? 'Registry written, but the native helper is not built \u2014 the wallpaper appears at the next logon.'
      : 'Wallpaper applied.', r.systemParametersInfo === false ? 'warn' : 'ok');
  }

  // ── Thumbnail loader ───────────────────────────────────
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

  async function call(channel, arg, arg2) {
    try {
      var payload;
      if (arg2 !== undefined) payload = await api.shell[channel](arg, arg2);
      else if (arg !== undefined) payload = await api.shell[channel](arg);
      else payload = await api.shell[channel]();
      if (payload && payload.state) render(payload.state);
      return payload ? payload.result : null;
    } catch (err) {
      say('\u2716 ' + err.message, 'err');
      return null;
    }
  }

  // Cache start menu + folder data: only fetch once or on explicit refresh
  var startMenuCache = null;
  var folderCache = null;

  async function refresh() {
    try {
      var st = await api.shell.getState();
      // Only fetch start menu + folders on first load or explicit refresh
      if (!startMenuCache || !folderCache) {
        var extResults = await Promise.allSettled([
          api.shell.getStartMenuState(),
          api.shell.listSpecialFolders()
        ]);
        if (extResults[0].status === 'fulfilled' && extResults[0].value) {
          startMenuCache = extResults[0].value;
        }
        if (extResults[1].status === 'fulfilled' && extResults[1].value) {
          folderCache = extResults[1].value;
        }
      }
      st.startMenu = startMenuCache;
      st.specialFolders = folderCache;
      render(st);
    } catch (err) {
      el.section.style.display = 'none';
      el.section.dataset.supported = 'false';
    }
  }

  // ── Wiring ─────────────────────────────────────────────
  el.refresh.addEventListener('click', function () {
    startMenuCache = null;
    folderCache = null;
    refresh();
  });

  // Taskbar position
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

  // Accent
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

  el.accentColor.addEventListener('input', function () {
    el.accentHexInput.value = el.accentColor.value;
  });

  el.accentApplyHex.addEventListener('click', async function () {
    var hex = el.accentHexInput.value.trim();
    if (!hex) return say('\u2716 Enter a hex colour.', 'err');
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return say('\u2716 Use format #RRGGBB.', 'err');
    await applyAccentHex(hex);
  });

  el.accentHexInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') el.accentApplyHex.click();
  });

  // Wallpaper
  el.wallpaperBrowse.addEventListener('click', async function () {
    var r = await call('pickWallpaper');
    if (!r || r.ok === false) return;
    el.wallpaperPath.value = r.path;
    say('Selected ' + esc(r.base) + '. Press Apply.', 'ok');
  });

  el.wallpaperApply.addEventListener('click', async function () {
    await applyWallpaperPath(el.wallpaperPath.value.trim());
  });

  el.wallpaperPath.addEventListener('change', function () { loadThumb(el.wallpaperPath.value.trim()); });

  el.wallpaperGalleryBtn.addEventListener('click', function () {
    galleryVisible = !galleryVisible;
    el.galleryContainer.style.display = galleryVisible ? '' : 'none';
    el.wallpaperGalleryBtn.textContent = galleryVisible ? 'Hide gallery' : 'Gallery';
    if (galleryVisible && !galleryLoaded) loadGallery();
  });

  el.wallpaperOpenFolder.addEventListener('click', async function () {
    var r = await api.shell.openWallpaperFolder();
    if (r && r.ok === false) say('\u2716 ' + r.error, 'err');
  });

  // Start menu
  el.startRecent.addEventListener('change', async function () {
    startMenuCache = null;
    var r = await call('setStartMenuToggle', 'showRecentApps', el.startRecent.checked);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say('Recent apps ' + (r.enabled ? 'shown' : 'hidden') + '.', 'ok');
  });

  el.startSuggestions.addEventListener('change', async function () {
    startMenuCache = null;
    var r = await call('setStartMenuToggle', 'showSuggestions', el.startSuggestions.checked);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say('Suggestions ' + (r.enabled ? 'shown' : 'hidden') + '.', 'ok');
  });

  el.startFullscreen.addEventListener('change', async function () {
    startMenuCache = null;
    var r = await call('setStartMenuToggle', 'fullScreenStart', el.startFullscreen.checked);
    if (!r) return;
    if (r.ok === false) return say('\u2716 ' + r.error, 'err');
    say('Start menu ' + (r.enabled ? 'full-screen' : 'classic') + '.', 'ok');
  });

  el.startOpenSettings.addEventListener('click', async function () {
    var r = await api.shell.openWindowsPersonalization();
    if (r && r.ok === false) say('\u2716 ' + r.error, 'err');
  });

  // Folder customization — delegate clicks
  el.folderList.addEventListener('click', async function (ev) {
    var btn = ev.target.closest('.folder-customize');
    if (!btn) return;
    var folderPath = btn.dataset.path;
    if (!folderPath) return;
    say('Reading folder icon\u2026');
    try {
      var r = await api.shell.readFolderCustomization(folderPath);
      if (!r || !r.ok) { say('\u2716 ' + ((r && r.error) || 'Cannot read folder'), 'err'); return; }
      var current = r.iconResource || r.iconFile || '(default)';
      say('Folder ' + esc(folderPath.split(/[\\/]/).pop()) + ': ' + (r.hasDesktopIni ? 'icon = ' + esc(current) : 'no custom icon'));
    } catch (err) {
      say('\u2716 ' + err.message, 'err');
    }
  });

  // Widget
  el.widgetOpen.addEventListener('click', async function () {
    var r = await api.shell.openWidget();
    if (r && r.ok === false) say('\u2716 ' + r.error, 'err');
    else say('Opened the ' + esc(el.widgetName.textContent) + ' repository.', 'ok');
  });

  // Restart explorer
  el.message.addEventListener('click', async function (ev) {
    if (!ev.target || ev.target.id !== 'shell-restart-explorer') return;
    say('Restarting explorer.exe\u2026');
    var r = await call('restartExplorer');
    if (!r) return;
    say(r.ok ? 'Explorer restarted. Changes applied.' : '\u2716 ' + r.error, r.ok ? 'ok' : 'err');
  });

  // Main process broadcasts every persisted shell change
  api.on('shell-config-changed', function () { refresh(); });

  refresh();
})();
