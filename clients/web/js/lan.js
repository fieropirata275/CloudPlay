/* LOCAL LAN MODE: dos (o hasta 8) consolas de la nube con el mismo código quedan en la misma red local, para los
 * juegos con multijugador por LAN (adaptador de red de PS2, Broadband Adapter de GameCube).
 * El cable virtual lo pone la sesión (lanlink.py) y el switch el orquestador (control-plane/app/lan.py). */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var $ = function (s) { return document.querySelector(s); };
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var PLATFORMS = { ps2: 1, gc: 1 };  // consolas con adaptador de red
  var h = null, player = null, state = { state: 'off' }, open = false;

  function newCode() {
    var out = '', bytes = new Uint8Array(6);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < 6; j++) out += ALPHABET.charAt(bytes[j] % ALPHABET.length);
    return out;
  }
  function pretty(code) { return code ? code.slice(0, 3) + '-' + code.slice(3) : ''; }
  function clean(code) {
    var c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 6) return null;
    for (var i = 0; i < 6; i++) if (ALPHABET.indexOf(c.charAt(i)) < 0) return null;
    return c;
  }

  // ------------------------------------------------------------------ hoja
  function render() {
    var s = state.state, on = s === 'on', waiting = s === 'waiting';
    $('#lan-join').hidden = on || waiting;
    $('#lan-room').hidden = !(on || waiting);
    $('#lan-code').textContent = pretty(state.code);
    var n = state.members || 0;
    $('#lan-status').textContent = on ? 'LOCAL LAN MODE ON · ' + n + ' consolas en la misma red'
      : state.reconnecting ? 'Reconectando con la red…' : 'Esperando a la otra consola… pásale el código';
    $('#lan-room').className = 'lan-room' + (on ? ' on' : '');
    $('#lan-ip').textContent = state.slot ? 'Tu consola: 10.77.0.' + (10 + state.slot) + ' (por DHCP)' : '';
  }

  function openSheet(p) {
    player = p;
    open = true;
    render();
    h.openSheet($('#lan-sheet'));
    CP.navSetActive(true);
    CP.navOnBack(close);
    setTimeout(function () { var f = $('#lan-room').hidden ? $('#lan-create') : $('#lan-copy'); if (f) f.focus(); }, 60);
  }
  function close() {
    if (!open) return;
    open = false;
    h.closeSheet($('#lan-sheet')).then(function () { if (h.onClose) h.onClose(); });
  }

  function join(code) {
    if (!player) return;
    state = { state: 'waiting', code: code, members: 1 };
    render();
    player.control({ t: 'lan', code: code });
  }

  /** Mensajes de la sesión: {t:'lan', state, code, slot, members, error} */
  function onState(m) {
    if (m.state === 'unsupported') return;
    var before = state;
    if (m.error) h.toast(m.error);
    state = m;
    if (open) render();
    if (m.state === 'on' && (before.state !== 'on' || (m.members || 0) > (before.members || 0))) {
      CP.LanFx.on(platformOf(), m.members || 2);
    } else if (before.state === 'on' && m.state === 'waiting' && !m.reconnecting) {
      h.toast('Una consola ha salido de la red local');
    } else if (before.state === 'on' && m.state === 'off') {
      CP.LanFx.off(platformOf());
    }
  }
  function platformOf() { return player && player.platform ? player.platform() : 'ps2'; }

  function init(helpers) {
    h = helpers;
    $('#lan-create').addEventListener('click', function () { join(newCode()); });
    $('#lan-go').addEventListener('click', function () {
      var c = clean($('#lan-input').value);
      if (!c) { h.toast('El código son 6 letras y números, como K7Q-2MX'); return; }
      join(c);
    });
    $('#lan-input').addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); $('#lan-go').click(); } });
    $('#lan-copy').addEventListener('click', function () {
      var text = pretty(state.code);
      var done = function () { h.toast('Código copiado: ' + text); };
      if (root.navigator.share) root.navigator.share({ title: 'CloudPlay LAN', text: 'Únete a mi red local de CloudPlay con el código ' + text }).catch(function () {});
      else if (root.navigator.clipboard) root.navigator.clipboard.writeText(text).then(done, done);
      else done();
    });
    $('#lan-leave').addEventListener('click', function () {
      if (player) player.control({ t: 'lan-leave' });
      if (state.state === 'on') CP.LanFx.off(platformOf());
      state = { state: 'off' };
      render();
    });
    $('#lan-close').addEventListener('click', close);
  }

  CP.Lan = {
    init: init, open: openSheet, onState: onState, supported: function (platform) { return !!PLATFORMS[platform]; },
    reset: function () { state = { state: 'off' }; player = null; }, state: function () { return state; },
    _newCode: newCode, _clean: clean
  };

  // ------------------------------------------------------------------ animación
  // Dos consolas que se acercan, un cable que se dibuja entre ellas, paquetes que van y vienen y LOCAL LAN MODE ON.
  var CONSOLE = {
    ps2: '<rect x="8" y="10" width="44" height="60" rx="3"/><path d="M12 18h36M12 62h36"/><circle cx="44" cy="66" r="1.6"/>',
    gc: '<rect x="8" y="16" width="46" height="46" rx="8"/><circle cx="31" cy="39" r="12"/><path d="M8 54h46"/>'
  };
  function svgConsole(platform, cls) {
    return '<svg class="lanfx-console ' + cls + '" viewBox="0 0 62 80" aria-hidden="true">' + (CONSOLE[platform] || CONSOLE.ps2) + '</svg>';
  }
  function show(html, cls, life) {
    var el = document.createElement('div');
    el.className = 'lanfx ' + cls;
    el.setAttribute('role', 'status');
    el.innerHTML = html;
    document.body.appendChild(el);
    void el.offsetWidth;
    el.classList.add('in');
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 600);
    }, life);
  }
  CP.LanFx = {
    on: function (platform, members) {
      platform = platform === 'gc' ? 'gc' : 'ps2';
      var dots = '';
      for (var i = 0; i < 5; i++) dots += '<i style="animation-delay:' + (1.1 + i * 0.22) + 's"></i><i class="back" style="animation-delay:' + (1.2 + i * 0.22) + 's"></i>';
      show('<div class="lanfx-stage">' + svgConsole(platform, 'l') +
        '<svg class="lanfx-cable" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 20 C 50 -4, 150 44, 200 20"/></svg>' +
        '<span class="lanfx-packets">' + dots + '</span>' + svgConsole(platform, 'r') + '</div>' +
        '<p class="lanfx-title">LOCAL LAN MODE <b>ON</b></p>' +
        '<p class="lanfx-sub">' + members + ' consolas en la misma red local</p>', 'lanfx-' + platform, 4200);
    },
    off: function (platform) {
      show('<p class="lanfx-title small">LOCAL LAN MODE <b>OFF</b></p>', 'lanfx-' + (platform === 'gc' ? 'gc' : 'ps2') + ' lanfx-off', 2000);
    }
  };
})(window);
