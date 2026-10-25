/* Pantallas, rutas (#/...) y flujo de la app. */
(function (root) {
  'use strict';
  var CP = root.CP, fx = CP.fx;
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var UA = navigator.userAgent;
  var isTV = /Tizen|Web0S|WebOS|SMART-TV|SmartTV|NetCast|BRAVIA|AFT|Android TV/i.test(UA) || /[?&]tv=1/.test(location.search);
  CP.isTV = isTV;
  document.documentElement.classList.toggle('tv', isTV);

  var state = { games: [], filter: 'all', query: '', player: null, devicePoll: null, session: null, me: null, introDone: false, quality: 0 };

  if (root.tizen && tizen.tvinputdevice) {
    try { tizen.tvinputdevice.registerKeyBatch(['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause', '1', '2', '3']); } catch (e) {}
  }

  // Todas las marcas empiezan como nube
  $$('.mark-shape').forEach(function (p) { p.setAttribute('d', fx.SHAPES.cloud); });

  // ------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(id) {
    var next = document.getElementById(id);
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s === next); });
    if (id !== 'screen-player') fx.animate(next, { opacity: [0, 1] }, { duration: 0.25 });
    setTimeout(CP.navFocusFirst, 40);
  }
  var toastTimer;
  function toast(text) {
    var t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    fx.animate(t, { opacity: [0, 1], y: [24, 0] }, fx.spring(520, 32));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      fx.animate(t, { opacity: 0, y: 16 }, { duration: 0.2 }).then(function () { t.hidden = true; });
    }, 2600);
  }
  CP.toast = toast;

  function openSheet(el) {
    el.hidden = false;
    fx.animate(el, { opacity: [0, 1] }, { duration: 0.18 });
    fx.animate(el.firstElementChild, { y: [40, 0], scale: [0.96, 1] }, fx.spring(440, 30));
  }
  function closeSheet(el) {
    return fx.animate(el, { opacity: 0 }, { duration: 0.14 }).then(function () { el.hidden = true; el.style.opacity = ''; });
  }

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
      el.onclick = function () { closeSheet(m); if (b.action) b.action(); };
      box.appendChild(el);
    });
    openSheet(m);
    CP.navSetActive(true);
    CP.navOnBack(function () {
      closeSheet(m);
      var last = buttons[buttons.length - 1];
      if (last.cancel && last.action) last.action();
    });
    setTimeout(CP.navFocusFirst, 40);
  }

  function loadMe() {
    if (state.me || !CP.token()) return Promise.resolve(state.me);
    return CP.api('GET', '/api/auth/me').then(function (me) { state.me = me; return me; }).catch(function () { return null; });
  }

  // ---------------------------------------------------------------- rutas
  function route() {
    var h = location.hash || '';
    stopDevicePoll();
    if (CP.adminStop) CP.adminStop();
    if (!/^#\/play\//.test(h) && state.player) endPlayer();
    if (h.indexOf('#/link') === 0) return renderLink();
    if (!CP.token()) return renderLogin();
    if (h.indexOf('#/play/') === 0) return renderPlay(h.slice(7));
    if (h.indexOf('#/admin') === 0) return renderAdmin();
    return renderLibrary();
  }
  root.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- login
  /** El logotipo: nube que se pliega en "play" y vuelve. Una sola vez por pantalla. */
  function playMark(scope) {
    var p = scope.querySelector('.mark-shape');
    if (!p || !fx.hasMorph) return;
    p.setAttribute('d', fx.SHAPES.cloud);
    fx.morph(p, 'play', { duration: 1.1, delay: 0.5 }).then(function () { return fx.morph(p, 'cloud', { duration: 1, delay: 0.9 }); });
  }

  function renderLogin() {
    show('screen-login');
    CP.navSetActive(true);
    CP.navOnBack(null);
    $('#server-input').value = CP.serverUrl();
    $('#login-form').hidden = isTV;
    $('#login-toggle').hidden = !isTV;
    playMark($('#screen-login'));
    startDeviceFlow();
  }

  function setCode(code) {
    var el = $('#device-code');
    el.innerHTML = code.split('').map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('');
    fx.animate(el.children, { opacity: [0, 1], y: [14, 0] }, { delay: fx.stagger(0.05), duration: 0.35 });
  }

  function startDeviceFlow() {
    CP.api('POST', '/api/auth/device/start').then(function (d) {
      setCode(d.user_code);
      $('#device-url').textContent = d.verification_uri.replace(/^https?:\/\//, '');
      var deadline = Date.now() + d.expires_in * 1000;
      state.devicePoll = setInterval(function () {
        if (Date.now() > deadline) { stopDevicePoll(); return startDeviceFlow(); }
        CP.api('POST', '/api/auth/device/poll', { device_code: d.device_code }).then(function (r) {
          if (r.status === 'approved') { stopDevicePoll(); CP.token(r.access_token); state.me = r.user; location.hash = '#/library'; route(); }
        }).catch(function (e) { if (e.status === 410) { stopDevicePoll(); startDeviceFlow(); } });
      }, d.interval * 1000);
    }).catch(function () {
      $('#device-code').textContent = 'Sin conexión';
      $('#device-url').textContent = 'Revisa la dirección del servidor';
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
        state.me = r.user;
        if (location.hash.indexOf('#/link') === 0) renderLink(); else { location.hash = '#/library'; route(); }
      })
      .catch(function (e2) { err.textContent = e2.status === 401 ? 'Email o contraseña incorrectos.' : e2.message; });
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
    playMark($('#screen-link'));
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
      .then(function () {
        msg.textContent = 'Tele conectada. Ya puedes elegir juego en ella.';
        msg.className = 'ok';
        fx.morph($('#screen-link .mark-shape'), 'play', { duration: 0.8 });
      })
      .catch(function (e2) { msg.textContent = e2.status === 404 ? 'Ese código no existe o ha caducado. Mira el de la tele.' : e2.message; msg.className = 'error'; });
  });

  // -------------------------------------------------------------- library
  function renderLibrary() {
    show('screen-library');
    CP.navSetActive(true);
    CP.navOnBack(null);
    loadMe().then(function (me) { $('#admin-link').hidden = !(me && me.is_admin); });
    Promise.all([CP.api('GET', '/api/games'), CP.api('GET', '/api/sessions')]).then(function (r) {
      state.games = r[0];
      drawResume(r[1][0]);
      drawAll();
      movePill(false);
      // Un único momento orquestado: la biblioteca aparece en cascada la primera vez
      if (!state.introDone) {
        state.introDone = true;
        fx.animate($$('#screen-library .tile'), { opacity: [0, 1], y: [18, 0] }, { delay: fx.stagger(0.025, { startDelay: 0.05 }), duration: 0.4 });
      }
      setTimeout(CP.navFocusFirst, 60);
    }).catch(function (e) { if (e.status !== 401) toast(e.message); });
  }

  var STATUS_TEXT = { queued: 'Esperando en la cola', starting: 'Arrancando', running: 'Partida abierta', ending: 'Cerrándose' };
  function drawResume(s) {
    var box = $('#resume');
    if (!s) { box.hidden = true; return; }
    box.hidden = false;
    $('#resume-kicker').textContent = STATUS_TEXT[s.status] || 'Partida abierta';
    $('#resume-title').textContent = s.game ? s.game.title : '';
    $('#resume-art').innerHTML = s.game ? caseHtml(s.game) : '';
    $('#resume-btn').onclick = function () { state.session = s; location.hash = '#/play/' + s.id; };
    $('#resume-end').onclick = function () { CP.api('DELETE', '/api/sessions/' + s.id).then(function () { toast('Partida cerrada'); renderLibrary(); }); };
  }

  function caseHtml(g) {
    var art = g.cover_url
      ? '<img src="' + esc(g.cover_url) + '" alt="" loading="lazy">'
      : '<span class="cover"><span class="cover-title">' + esc(g.title) + '</span></span>';
    return '<span class="case p-' + esc(g.platform) + '"><span class="spine">' + esc(g.platform_name) + '</span>' + art + '</span>';
  }

  function tileHtml(g) {
    var meta = g.play_count ? (g.play_count === 1 ? 'Jugado 1 vez' : 'Jugado ' + g.play_count + ' veces') : g.platform_name;
    return '<button class="tile' + (g.favorite ? ' is-fav' : '') + (g.cover_url ? '' : ' no-cover') + '" data-focus data-id="' + esc(g.id) + '">' + caseHtml(g) +
      '<span class="fav" role="switch" aria-checked="' + (g.favorite ? 'true' : 'false') + '" aria-label="Favorito" data-fav>' +
      '<svg viewBox="0 0 100 100"><path d="' + (g.favorite ? fx.ICONS.star : fx.ICONS.plus) + '"/></svg></span>' +
      '<span class="tile-name">' + esc(g.title) + '</span><span class="tile-meta">' + esc(meta) + '</span></button>';
  }

  function visible(g) {
    var q = state.query;
    return (state.filter === 'all' || g.platform === state.filter) &&
      (!q || g.title.toLowerCase().indexOf(q) >= 0);
  }

  function drawAll() {
    var games = state.games.filter(visible);
    var recent = games.filter(function (g) { return g.last_played; })
      .sort(function (a, b) { return a.last_played < b.last_played ? 1 : -1; }).slice(0, 12);
    var favs = games.filter(function (g) { return g.favorite; });
    var searching = !!state.query;
    drawRail('#rail-recent', searching ? [] : recent);
    drawRail('#rail-fav', searching ? [] : favs);
    $('#all-title').textContent = searching ? 'Resultados' : 'Toda la biblioteca';
    var grid = $('#grid');
    if (!state.games.length) {
      grid.innerHTML = '<p class="empty"><strong>Todavía no hay juegos.</strong>Copia tus ROMs en la librería de los nodos (carpetas ps2, gc y wii) y aparecerán aquí solas.</p>';
    } else if (!games.length) {
      grid.innerHTML = '<p class="empty"><strong>Nada coincide con «' + esc(state.query) + '».</strong>Prueba con otra palabra o cambia de plataforma.</p>';
    } else grid.innerHTML = games.map(tileHtml).join('');
  }
  function drawRail(sel, list) {
    var rail = $(sel);
    rail.hidden = !list.length;
    rail.querySelector('.rail-track').innerHTML = list.map(tileHtml).join('');
  }

  // Selector de plataforma: la píldora se desliza con un muelle hasta el filtro activo
  function movePill(animate) {
    var on = $('.filter.on'), pill = $('.filter-pill');
    if (!on || !pill) return;
    var target = { x: on.offsetLeft, width: on.offsetWidth };
    if (animate && fx.hasMotion) fx.animate(pill, { x: target.x, width: target.width + 'px' }, fx.spring(380, 30));
    else { pill.style.width = target.width + 'px'; pill.style.transform = 'translateX(' + target.x + 'px)'; }
  }
  $$('.filter').forEach(function (b) {
    b.addEventListener('click', function () {
      state.filter = b.getAttribute('data-platform');
      $$('.filter').forEach(function (x) { x.classList.toggle('on', x === b); });
      movePill(true);
      drawAll();
      fx.animate($$('#grid .tile'), { opacity: [0, 1] }, { delay: fx.stagger(0.015), duration: 0.25 });
    });
  });
  root.addEventListener('resize', function () { movePill(false); });

  var searchTimer;
  $('#search').addEventListener('input', function (e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.query = e.target.value.trim().toLowerCase(); drawAll(); }, 120);
  });

  var lib = $('.library');
  lib.addEventListener('click', function (e) {
    var favBtn = e.target.closest ? e.target.closest('[data-fav]') : null;
    var t = e.target.closest ? e.target.closest('.tile') : null;
    if (!t) return;
    if (favBtn) { e.stopPropagation(); toggleFav(t); return; }
    startGame(t.getAttribute('data-id'));
  });
  lib.addEventListener('cp-secondary', function (e) {
    var t = e.target.closest ? e.target.closest('.tile') : null;
    if (t) toggleFav(t);
  });
  fx.focusSpring(lib, '.tile', 1.06);

  /** Favorito: optimista, con el "+" transformándose en estrella (MorphSVG) y un pop con muelle. */
  function toggleFav(tile) {
    var id = tile.getAttribute('data-id');
    var g = state.games.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    g.favorite = !g.favorite;
    $$('.tile[data-id="' + id + '"]').forEach(function (t) {
      t.classList.toggle('is-fav', g.favorite);
      var sw = t.querySelector('[data-fav]');
      sw.setAttribute('aria-checked', g.favorite ? 'true' : 'false');
      fx.morph(sw.querySelector('path'), g.favorite ? 'star' : 'plus', { duration: 0.55, ease: 'back.out(2)' });
      fx.animate(sw, { scale: [1.35, 1] }, fx.spring(600, 14));
    });
    toast(g.favorite ? 'Añadido a favoritos' : 'Quitado de favoritos');
    CP.api(g.favorite ? 'PUT' : 'DELETE', '/api/favorites/' + id).then(function () {
      // Redibuja las filas sin perder el foco de la cuadrícula
      var focused = document.activeElement && document.activeElement.getAttribute('data-id');
      var inGrid = document.activeElement && document.activeElement.closest && document.activeElement.closest('#grid');
      drawRail('#rail-fav', state.query ? [] : state.games.filter(function (x) { return x.favorite && visible(x); }));
      if (focused && inGrid) { var again = $('#grid .tile[data-id="' + focused + '"]'); if (again) again.focus(); }
    }).catch(function (err) { g.favorite = !g.favorite; toast(err.message); drawAll(); });
  }

  $('#logout').addEventListener('click', function () { CP.token(null); state.me = null; location.hash = '#/login'; route(); });

  function startGame(gameId) {
    CP.api('POST', '/api/sessions', { game_id: gameId }).then(function (s) {
      state.session = s;
      location.hash = '#/play/' + s.id;
    }).catch(function (e) {
      if (e.status === 409) {
        CP.api('GET', '/api/sessions').then(function (active) {
          var s = active[0];
          modal('Ya tienes una partida abierta', s && s.game ? s.game.title : '', [
            { label: 'Volver a esa partida', action: function () { state.session = s; location.hash = '#/play/' + s.id; } },
            { label: 'Cerrarla y jugar a este', action: function () {
              CP.api('DELETE', '/api/sessions/' + s.id).then(function () { setTimeout(function () { startGame(gameId); }, 1500); });
            } },
            { label: 'Cancelar', cancel: true }
          ]);
        });
      } else modal('No se pudo arrancar', e.message, [{ label: 'Vale' }]);
    });
  }

  // ----------------------------------------------------------------- admin
  function renderAdmin() {
    loadMe().then(function (me) {
      if (!me || !me.is_admin) { location.hash = '#/library'; return; }
      show('screen-admin');
      CP.navSetActive(true);
      CP.navOnBack(function () { location.hash = '#/library'; });
      CP.adminStart();
    });
  }

  // ------------------------------------------------------------ arranque
  var STEPS = ['queue', 'booting', 'linking', 'live'];
  var boot = { step: null, shape: 'cloud', platform: null };

  /** Pantalla de arranque: la nube se transforma en la consola del juego según avanza la conexión. */
  function bootStage(name, data) {
    var el = $('#boot');
    if (name === 'error') { $('#boot-msg').textContent = data.text || 'Algo ha fallado.'; bootShape('warn'); return; }
    if (name === 'reconnecting') {
      if (el.hidden) { el.hidden = false; fx.animate(el, { opacity: [0, 0.92] }, { duration: 0.3 }); }
      $('#boot-msg').textContent = '';
      setStep('linking');
      return;
    }
    if (name === 'queue') {
      $('#boot-queue').hidden = false;
      $('[data-step="queue"]').hidden = false;
      fx.count($('#boot-pos'), data.position || 1);
      setStep('queue');
      bootShape('cloud');
      return;
    }
    $('#boot-queue').hidden = true;
    if (name === 'booting') { setStep('booting'); bootShape(boot.platform); }
    if (name === 'linking') { setStep('linking'); bootShape(boot.platform); }
    if (name === 'live') {
      setStep('live');
      bootShape('play').then(function () {
        return fx.animate(el, { opacity: 0, scale: 1.04 }, { duration: 0.45 });
      }).then(function () { el.hidden = true; el.style.opacity = ''; el.style.transform = ''; });
    }
  }
  function setStep(name) {
    var idx = STEPS.indexOf(name);
    $$('#boot-steps li').forEach(function (li) {
      var i = STEPS.indexOf(li.getAttribute('data-step'));
      li.classList.toggle('done', i < idx);
      li.classList.toggle('now', i === idx);
    });
    boot.step = name;
  }
  function bootShape(name) {
    if (!name || boot.shape === name) return Promise.resolve();
    boot.shape = name;
    var detail = $('#boot-detail');
    fx.animate(detail, { opacity: 0 }, { duration: 0.15 });
    return fx.morph($('#boot-shape'), name, { duration: 0.95 }).then(function () {
      detail.setAttribute('d', fx.DETAILS[name] || '');
      if (fx.DETAILS[name]) fx.animate(detail, { opacity: [0, 0.9] }, { duration: 0.4 });
    });
  }
  function resetBoot(game) {
    var el = $('#boot');
    el.hidden = false; el.style.opacity = ''; el.style.transform = '';
    boot = { step: null, shape: 'cloud', platform: game ? game.platform : 'play' };
    $('#boot-shape').setAttribute('d', fx.SHAPES.cloud);
    $('#boot-detail').setAttribute('d', '');
    $('#boot-game').textContent = game ? game.title : '';
    $('#boot-msg').textContent = '';
    $('#boot-queue').hidden = true;
    $('[data-step="queue"]').hidden = true;
    setStep('booting');
    if (fx.hasMorph) {
      // la nube "respira" mientras espera
      root.gsap.fromTo('#boot-shape', { scale: 0.96, transformOrigin: '50% 50%' }, { scale: 1.02, duration: 1.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
  }
  $('#boot-cancel').addEventListener('click', function () {
    var p = state.player;
    if (!p) return backToLibrary();
    var sid = p.session.id;
    endPlayer();
    CP.api('DELETE', '/api/sessions/' + sid).catch(function () {});
    backToLibrary();
  });

  // ----------------------------------------------------------------- play
  function renderPlay(sid) {
    show('screen-player');
    CP.navSetActive(true); // en el arranque solo hay "Cancelar"
    CP.navOnBack(function () { $('#boot-cancel').click(); });
    var go = state.session && state.session.id === sid ? Promise.resolve(state.session) : CP.api('GET', '/api/sessions/' + sid);
    go.then(function (s) {
      resetBoot(s.game);
      if (!s.signal_url) { modal('Esta partida ya terminó', s.error || '', [{ label: 'Volver a la biblioteca', action: backToLibrary }]); return; }
      state.player = new CP.Player({
        session: s,
        video: $('#video'),
        isTV: isTV,
        onStatus: function () {},
        onStage: function (name, data) {
          bootStage(name, data);
          if (name === 'live') { CP.navSetActive(false); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
        },
        onToast: toast,
        onStats: drawStats,
        onMenu: openMenu,
        onEnd: function (reason) {
          endPlayer();
          CP.navSetActive(true);
          modal('Partida terminada', reason, [{ label: 'Volver a la biblioteca', action: backToLibrary }]);
        }
      });
      if (state.quality) state.player.setQuality(state.quality);
      state.player.start();
    }).catch(function (e) { modal('No se pudo abrir la partida', e.message, [{ label: 'Volver', action: backToLibrary }]); });
  }

  function drawStats(s) {
    var el = $('#stats');
    if (el.hidden) return;
    el.textContent = s.fps + ' fps, ' + (s.kbps / 1000).toFixed(1) + ' de ' + (s.target / 1000).toFixed(1) + ' Mbps, ' +
      s.rtt + ' ms de ida y vuelta, ' + s.loss + '% perdido (' + s.encoder + ')';
  }

  function openMenu() {
    var p = state.player;
    var menu = $('#game-menu');
    if (!p || !menu.hidden) return;
    p.pauseInput(true);
    $('#menu-title').textContent = p.session.game ? p.session.game.title : 'Menú';
    $$('#quality .btn').forEach(function (b) { b.classList.toggle('on', parseInt(b.getAttribute('data-kbps'), 10) === state.quality); });
    openSheet(menu);
    CP.navSetActive(true);
    CP.navOnBack(closeMenu);
    setTimeout(CP.navFocusFirst, 40);
  }
  function closeMenu() {
    closeSheet($('#game-menu'));
    CP.navSetActive(false);
    if (state.player) state.player.pauseInput(false);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  $('#game-menu').addEventListener('click', function (e) {
    var a = e.target.getAttribute && e.target.getAttribute('data-action');
    var p = state.player;
    if (!a || !p) return;
    if (a === 'resume') return closeMenu();
    if (a === 'stats') {
      var st = $('#stats');
      st.hidden = !st.hidden;
      if (!st.hidden) { st.textContent = 'Midiendo…'; fx.animate(st, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.25 }); }
      return closeMenu();
    }
    if (a === 'quality') {
      state.quality = parseInt(e.target.getAttribute('data-kbps'), 10) || 0;
      p.setQuality(state.quality);
      toast(state.quality ? 'Calidad fija en ' + state.quality / 1000 + ' Mbps' : 'Calidad automática');
      return closeMenu();
    }
    if (a === 'quit') {
      closeMenu();
      var sid = p.session.id;
      p.control({ t: 'quit' });
      endPlayer();
      CP.api('DELETE', '/api/sessions/' + sid).catch(function () {});
      toast('Juego cerrado');
      return backToLibrary();
    }
    if (a === 'detach') { closeMenu(); endPlayer(); toast('La partida sigue abierta'); return backToLibrary(); }
    p.control({ t: a }); // savestate / loadstate / nextslot
    closeMenu();
  });
  $('#menu-btn').addEventListener('click', openMenu);
  $('#video').addEventListener('click', function () { var v = $('#video'); if (v.muted) { v.muted = false; toast('Sonido activado'); } });

  function endPlayer() {
    if (state.player) { state.player.close(); state.player = null; }
    if (root.gsap) root.gsap.killTweensOf('#boot-shape');
    state.session = null;
    $('#stats').hidden = true;
  }
  function backToLibrary() { location.hash = '#/library'; }

  route();
})(window);
