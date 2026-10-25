/* Pantallas, rutas (#/...) y flujo de la app. */
(function (root) {
  'use strict';
  var CP = root.CP;
  var $ = function (sel) { return document.querySelector(sel); };
  var UA = navigator.userAgent;
  var isTV = /Tizen|Web0S|WebOS|SMART-TV|SmartTV|NetCast|BRAVIA|AFT|Android TV/i.test(UA) || /[?&]tv=1/.test(location.search);
  CP.isTV = isTV;
  document.documentElement.classList.toggle('tv', isTV);

  var state = { games: [], filter: 'all', player: null, devicePoll: null, session: null };
  var PLATFORM_COLORS = { ps2: ['#1d3fbb', '#0b1650'], gc: ['#6a3fc9', '#2a145a'], wii: ['#28a8d8', '#0b3d55'] };

  // Teclas multimedia de Tizen (si no se registran, la app no las recibe)
  if (root.tizen && tizen.tvinputdevice) {
    try { tizen.tvinputdevice.registerKeyBatch(['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause', '1', '2', '3']); } catch (e) {}
  }

  // ------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.toggle('active', s.id === id); });
    setTimeout(CP.navFocusFirst, 30);
  }
  var toastTimer;
  function toast(text) {
    var t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  CP.toast = toast;

  function modal(title, text, buttons) {
    var m = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text || '';
    var box = $('#modal-actions');
    box.innerHTML = '';
    buttons.forEach(function (b, i) {
      var el = document.createElement('button');
      el.className = 'btn' + (i === 0 ? ' primary' : '');
      el.textContent = b.label;
      if (i === 0) el.setAttribute('data-autofocus', '');
      el.onclick = function () { closeModal(); if (b.action) b.action(); };
      box.appendChild(el);
    });
    m.hidden = false;
    CP.navSetActive(true);
    CP.navOnBack(function () { closeModal(); var last = buttons[buttons.length - 1]; if (last.cancel && last.action) last.action(); });
    setTimeout(CP.navFocusFirst, 30);
  }
  function closeModal() { $('#modal').hidden = true; }

  // ---------------------------------------------------------------- rutas
  function route() {
    var h = location.hash || '';
    stopDevicePoll();
    if (!/^#\/play\//.test(h) && state.player) endPlayer(false);
    if (h.indexOf('#/link') === 0) return renderLink();
    if (!CP.token()) return renderLogin();
    if (h.indexOf('#/play/') === 0) return renderPlay(h.slice(7));
    return renderLibrary();
  }
  root.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- login
  function renderLogin() {
    show('screen-login');
    CP.navSetActive(true);
    CP.navOnBack(null);
    $('#server-input').value = CP.serverUrl();
    $('#login-form').hidden = isTV;
    $('#login-toggle').hidden = !isTV;
    startDeviceFlow();
  }

  function startDeviceFlow() {
    $('#device-code').textContent = '····-····';
    CP.api('POST', '/api/auth/device/start').then(function (d) {
      $('#device-code').textContent = d.user_code;
      $('#device-url').textContent = d.verification_uri.replace(/^https?:\/\//, '');
      var deadline = Date.now() + d.expires_in * 1000;
      state.devicePoll = setInterval(function () {
        if (Date.now() > deadline) { stopDevicePoll(); return startDeviceFlow(); }
        CP.api('POST', '/api/auth/device/poll', { device_code: d.device_code }).then(function (r) {
          if (r.status === 'approved') { stopDevicePoll(); CP.token(r.access_token); location.hash = '#/library'; route(); }
        }).catch(function (e) { if (e.status === 410) { stopDevicePoll(); startDeviceFlow(); } });
      }, d.interval * 1000);
    }).catch(function () {
      $('#device-code').textContent = 'sin conexión';
      $('#device-url').textContent = 'Revisa la URL del servidor';
    });
  }
  function stopDevicePoll() { if (state.devicePoll) { clearInterval(state.devicePoll); state.devicePoll = null; } }

  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#login-error');
    err.textContent = '';
    CP.api('POST', '/api/auth/login', { email: $('#email').value, password: $('#password').value })
      .then(function (r) {
        CP.token(r.access_token);
        if (location.hash.indexOf('#/link') === 0) renderLink(); else { location.hash = '#/library'; route(); }
      })
      .catch(function (e2) { err.textContent = e2.message; });
  });
  $('#login-toggle').addEventListener('click', function () { $('#login-form').hidden = false; $('#login-toggle').hidden = true; CP.navFocusFirst(); });
  $('#server-save').addEventListener('click', function () {
    CP.store('cp_server', $('#server-input').value.trim() || null);
    stopDevicePoll();
    startDeviceFlow();
    toast('Servidor guardado');
  });

  // ------------------------------------------------------- link (móvil)
  function renderLink() {
    show('screen-link');
    var logged = !!CP.token();
    $('#link-login').hidden = logged;
    $('#link-form').hidden = !logged;
    if (!logged) {
      $('#link-login').innerHTML = '';
      $('#link-login').appendChild($('#login-form'));
      $('#login-form').hidden = false;
    }
  }
  $('#link-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#link-msg');
    CP.api('POST', '/api/auth/device/approve', { user_code: $('#link-code').value })
      .then(function () { msg.textContent = '¡Listo! La tele ya está conectada.'; msg.className = 'ok'; })
      .catch(function (e2) { msg.textContent = e2.message; msg.className = 'error'; });
  });

  // -------------------------------------------------------------- library
  function renderLibrary() {
    show('screen-library');
    CP.navSetActive(true);
    CP.navOnBack(null);
    CP.api('GET', '/api/games').then(function (games) {
      state.games = games;
      drawGrid();
      return CP.api('GET', '/api/sessions');
    }).then(function (active) {
      var banner = $('#resume-banner');
      if (active && active.length) {
        var s = active[0];
        banner.hidden = false;
        $('#resume-title').textContent = s.game ? s.game.title : 'Partida en curso';
        $('#resume-btn').onclick = function () { location.hash = '#/play/' + s.id; };
        $('#resume-end').onclick = function () { CP.api('DELETE', '/api/sessions/' + s.id).then(renderLibrary); };
      } else banner.hidden = true;
    }).catch(function (e) { if (e.status !== 401) toast(e.message); });
  }

  function drawGrid() {
    var grid = $('#grid');
    var games = state.games.filter(function (g) { return state.filter === 'all' || g.platform === state.filter; });
    if (!games.length) {
      grid.innerHTML = '<p class="empty">No hay juegos aquí todavía. Copia ROMs en la librería de los nodos (ps2/, gc/, wii/).</p>';
      return;
    }
    grid.innerHTML = games.map(function (g) {
      var c = PLATFORM_COLORS[g.platform] || ['#333', '#111'];
      var art = g.cover_url
        ? '<img src="' + esc(g.cover_url) + '" alt="" loading="lazy">'
        : '<div class="art-fallback" style="background:linear-gradient(150deg,' + c[0] + ',' + c[1] + ')"><span>' + esc(g.title) + '</span></div>';
      return '<button class="tile' + (g.cover_url ? '' : ' no-cover') + '" data-focus data-id="' + esc(g.id) + '">' + art +
        '<span class="tile-meta"><span class="badge ' + esc(g.platform) + '">' + esc(g.platform_name) + '</span>' +
        '<span class="tile-title">' + esc(g.title) + '</span></span></button>';
    }).join('');
  }

  $('#grid').addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.tile') : null;
    if (t) startGame(t.getAttribute('data-id'));
  });
  Array.prototype.forEach.call(document.querySelectorAll('.filter'), function (b) {
    b.addEventListener('click', function () {
      state.filter = b.getAttribute('data-platform');
      Array.prototype.forEach.call(document.querySelectorAll('.filter'), function (x) { x.classList.toggle('on', x === b); });
      drawGrid();
    });
  });
  $('#logout').addEventListener('click', function () { CP.token(null); location.hash = '#/login'; route(); });

  function startGame(gameId) {
    CP.api('POST', '/api/sessions', { game_id: gameId }).then(function (s) {
      state.session = s;
      location.hash = '#/play/' + s.id;
    }).catch(function (e) {
      if (e.status === 409) {
        CP.api('GET', '/api/sessions').then(function (active) {
          var s = active[0];
          modal('Ya tienes una partida abierta', s && s.game ? s.game.title : '', [
            { label: 'Volver a ella', action: function () { location.hash = '#/play/' + s.id; } },
            { label: 'Cerrarla y jugar a este', action: function () {
              CP.api('DELETE', '/api/sessions/' + s.id).then(function () { setTimeout(function () { startGame(gameId); }, 1500); });
            } },
            { label: 'Cancelar', cancel: true }
          ]);
        });
      } else modal('No se pudo arrancar', e.message, [{ label: 'Vale' }]);
    });
  }

  // ----------------------------------------------------------------- play
  function renderPlay(sid) {
    show('screen-player');
    CP.navSetActive(false);
    $('#player-status').hidden = false;
    var go = state.session && state.session.id === sid ? Promise.resolve(state.session) : CP.api('GET', '/api/sessions/' + sid);
    go.then(function (s) {
      if (!s.signal_url) { modal('Sesión terminada', s.error || '', [{ label: 'Volver', action: backToLibrary }]); return; }
      state.player = new CP.Player({
        session: s,
        video: $('#video'),
        isTV: isTV,
        onStatus: setStatus,
        onToast: toast,
        onStats: drawStats,
        onMenu: openMenu,
        onEnd: function (reason) {
          endPlayer(false);
          CP.navSetActive(true);
          modal('Partida terminada', reason, [{ label: 'Volver a la biblioteca', action: backToLibrary }]);
        }
      });
      state.player.start();
    }).catch(function (e) { modal('Error', e.message, [{ label: 'Volver', action: backToLibrary }]); });
  }

  function setStatus(text, kind) {
    var el = $('#player-status');
    el.hidden = !text;
    el.className = 'player-status ' + (kind || '');
    $('#player-status-text').textContent = text;
  }

  function drawStats(s) {
    var el = $('#stats');
    if (el.hidden) return;
    el.textContent = s.fps + ' fps · ' + (s.kbps / 1000).toFixed(1) + ' Mbps (obj. ' + (s.target / 1000).toFixed(1) +
      ') · RTT ' + s.rtt + ' ms · pérdida ' + s.loss + '% · jitter ' + s.jitter + ' ms · ' + s.encoder;
  }

  function openMenu() {
    var p = state.player;
    if (!p || !$('#game-menu').hidden) return;
    p.pauseInput(true);
    $('#game-menu').hidden = false;
    CP.navSetActive(true);
    CP.navOnBack(closeMenu);
    setTimeout(CP.navFocusFirst, 30);
  }
  function closeMenu() {
    $('#game-menu').hidden = true;
    CP.navSetActive(false);
    if (state.player) state.player.pauseInput(false);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  $('#game-menu').addEventListener('click', function (e) {
    var a = e.target.getAttribute && e.target.getAttribute('data-action');
    var p = state.player;
    if (!a || !p) return;
    if (a === 'resume') return closeMenu();
    if (a === 'stats') { $('#stats').hidden = !$('#stats').hidden; return closeMenu(); }
    if (a === 'quality') {
      var q = parseInt(e.target.getAttribute('data-kbps'), 10);
      p.setQuality(q);
      toast(q ? 'Calidad fija: ' + q / 1000 + ' Mbps' : 'Calidad automática');
      return closeMenu();
    }
    if (a === 'quit') {
      closeMenu();
      var sid = p.session.id;
      p.control({ t: 'quit' });
      endPlayer(false);
      CP.api('DELETE', '/api/sessions/' + sid).catch(function () {});
      return backToLibrary();
    }
    if (a === 'detach') { closeMenu(); endPlayer(false); return backToLibrary(); }
    p.control({ t: a }); // savestate / loadstate / nextslot
    closeMenu();
  });
  $('#menu-btn').addEventListener('click', openMenu);
  $('#video').addEventListener('click', function () { var v = $('#video'); if (v.muted) { v.muted = false; toast('Sonido activado'); } });

  function endPlayer() {
    if (state.player) { state.player.close(); state.player = null; }
    state.session = null;
  }
  function backToLibrary() { location.hash = '#/library'; }

  route();
})(window);
