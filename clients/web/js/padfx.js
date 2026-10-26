/* Animaciones de conexión / desconexión de mandos durante la partida, con el estilo de cada consola.
 *   CP.PadFx.show('ps2' | 'gc' | 'wii', { kind: 'pad' | 'wiimote' | 'board', player: 1..8, connected, name })
 * Todo es CSS (vale en teles viejas); las siluetas son dibujos propios, sin logos ni marcas. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var LIFE = 2900, box = null, queue = 0;

  var SVG = {
    // mando de dos asas con dos sticks (PS2)
    ps2: '<svg viewBox="0 0 120 70" class="pfx-sil"><path d="M30 12h60c12 0 20 8 24 22l4 18c2 10-6 16-14 12l-14-8c-4-2-8-3-12-3H42c-4 0-8 1-12 3l-14 8C8 68 0 62 2 52l4-18C10 20 18 12 30 12z"/>' +
      '<circle cx="45" cy="42" r="7"/><circle cx="75" cy="42" r="7"/><path d="M22 28h12M28 22v12"/><circle cx="92" cy="22" r="2.6"/><circle cx="100" cy="29" r="2.6"/><circle cx="84" cy="29" r="2.6"/><circle cx="92" cy="36" r="2.6"/></svg>',
    // mando redondeado con botón grande y stick secundario (GameCube)
    gc: '<svg viewBox="0 0 120 76" class="pfx-sil"><path d="M26 14c10-6 58-6 68 0 12 7 22 24 24 38 2 12-8 20-18 14l-14-10c-6-3-10-3-14-3H48c-4 0-8 0-14 3L20 66C10 72 0 64 2 52 4 38 14 21 26 14z"/>' +
      '<circle cx="30" cy="32" r="8"/><circle cx="84" cy="30" r="7"/><circle cx="98" cy="22" r="3"/><circle cx="74" cy="20" r="3"/><circle cx="72" cy="50" r="5"/><path d="M42 50h10M47 45v10"/></svg>',
    // mando alargado con cruceta, botón A y 4 LEDs (Wii)
    wiimote: '<svg viewBox="0 0 40 120" class="pfx-sil"><rect x="6" y="2" width="28" height="116" rx="12"/><path d="M14 22h12M20 16v12"/><circle cx="20" cy="42" r="6"/>' +
      '<circle cx="20" cy="62" r="2"/><circle cx="20" cy="84" r="3"/><circle cx="20" cy="94" r="3"/></svg>',
    // tabla con 4 apoyos (Balance Board)
    board: '<svg viewBox="0 0 140 70" class="pfx-sil"><rect x="4" y="8" width="132" height="54" rx="22"/><path d="M70 14v42"/>' +
      '<circle cx="18" cy="18" r="3"/><circle cx="122" cy="18" r="3"/><circle cx="18" cy="52" r="3"/><circle cx="122" cy="52" r="3"/></svg>'
  };

  function text(platform, e) {
    var who = e.kind === 'board' ? 'Balance Board' : e.kind === 'wiimote' ? 'Wiimote ' + e.player : 'Mando ' + e.player;
    var state = e.connected ? (e.kind === 'board' ? 'conectada' : 'conectado') : (e.kind === 'board' ? 'desconectada' : 'desconectado');
    if (platform === 'gc' && e.kind === 'pad') return { title: 'Puerto ' + e.player, sub: state };
    if (platform === 'ps2' && e.kind === 'pad') return { title: 'Mando ' + e.player, sub: state };
    return { title: who, sub: state };
  }

  function build(platform, e) {
    var t = text(platform, e), el = document.createElement('div');
    var kind = e.kind === 'pad' ? platform : e.kind;
    el.className = 'pfx pfx-' + platform + (e.connected ? ' pfx-on' : ' pfx-off');
    el.setAttribute('role', 'status');
    var deco = '';
    if (platform === 'ps2') {
      deco = '<span class="pfx-towers">' + [1, 2, 3, 4, 5, 6].map(function (i) { return '<i style="animation-delay:' + i * 70 + 'ms"></i>'; }).join('') + '</span>';
    } else if (platform === 'gc') {
      deco = '<span class="pfx-cube"><i></i></span>';
    } else {
      var lit = ((e.player - 1) % 4);
      deco = '<span class="pfx-leds">' + [0, 1, 2, 3].map(function (i) { return '<i class="' + (i === lit ? 'me' : '') + '"></i>'; }).join('') + '</span>';
    }
    el.innerHTML = '<span class="pfx-art">' + (SVG[kind] || SVG[platform] || SVG.ps2) + '</span>' +
      '<span class="pfx-txt"><b>' + t.title + '</b><small>' + t.sub + '</small></span>' + deco;
    return el;
  }

  function show(platform, e) {
    if (!document.body || !e) return;
    platform = platform === 'gc' || platform === 'wii' ? platform : 'ps2';
    if (!box) {
      box = document.createElement('div');
      box.className = 'pfx-box';
      document.body.appendChild(box);
    }
    var el = build(platform, e);
    // varios a la vez (dos mandos que se conectan juntos): se apilan con un pequeño retardo
    var delay = queue++ * 180;
    setTimeout(function () {
      box.appendChild(el);
      // reflow para que arranquen las transiciones CSS
      void el.offsetWidth;
      el.classList.add('pfx-in');
    }, delay);
    setTimeout(function () {
      el.classList.add('pfx-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); queue = Math.max(0, queue - 1); }, 520);
    }, delay + LIFE);
  }

  CP.PadFx = { show: show };
})(window);
