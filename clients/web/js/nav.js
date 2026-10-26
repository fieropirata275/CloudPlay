/* Navegación espacial con flechas / D-pad / mando de la tele para los menús (fuera del juego). */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var active = true, padPaused = false, backHandler = null, lastPad = 0, padRepeatAt = 0;

  function focusables() {
    var scope = document.querySelector('.modal:not([hidden])') || document.querySelector('.screen.active');
    if (!scope) return [];
    return Array.prototype.filter.call(scope.querySelectorAll('[data-focus], button, input, select, a[href]'), function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  CP.navMove = function (dir) {
    var list = focusables();
    if (!list.length) return;
    var cur = document.activeElement;
    if (list.indexOf(cur) < 0) { list[0].focus(); return; }
    var c = center(cur.getBoundingClientRect()), best = null, bestScore = Infinity;
    list.forEach(function (el) {
      if (el === cur) return;
      var p = center(el.getBoundingClientRect()), dx = p.x - c.x, dy = p.y - c.y;
      var ok = (dir === 'left' && dx < -4) || (dir === 'right' && dx > 4) || (dir === 'up' && dy < -4) || (dir === 'down' && dy > 4);
      if (!ok) return;
      var along = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
      var across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      var score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) {
      best.focus();
      if (best.scrollIntoView) best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  CP.navFocusFirst = function () {
    var list = focusables();
    var pref = list.filter(function (el) { return el.hasAttribute('data-autofocus'); })[0];
    if (pref || list[0]) (pref || list[0]).focus();
  };

  // Acción secundaria sobre el elemento enfocado (favorito): Y del mando, tecla F o botón amarillo.
  function secondary() {
    var el = document.activeElement;
    if (el) el.dispatchEvent(new CustomEvent('cp-secondary', { bubbles: true }));
  }

  CP.navSetActive = function (v) { active = v; };
  // Con la hoja de mandos abierta el mando se está probando: no debe mover el foco ni pulsar botones
  CP.navPadPause = function (v) { padPaused = v; lastPad = 0; };
  CP.navOnBack = function (fn) { backHandler = fn; };

  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  root.addEventListener('keydown', function (e) {
    if (!active) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if ((e.keyCode === 70 || e.keyCode === 405) && document.activeElement && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      secondary();
      return;
    }
    if (DIRS[e.keyCode]) {
      if (tag === 'INPUT' && (e.keyCode === 37 || e.keyCode === 39)) return;
      e.preventDefault();
      CP.navMove(DIRS[e.keyCode]);
    } else if (CP.MENU_KEYS && CP.MENU_KEYS[e.keyCode] && !(tag === 'INPUT' && e.keyCode === 8)) {
      if (backHandler) { e.preventDefault(); backHandler(); }
    }
  });

  // Mando en los menús: D-pad/stick mueven, A pulsa, B atrás
  function poll() {
    if (active && !padPaused && navigator.getGamepads) {
      var gp = Array.prototype.filter.call(navigator.getGamepads() || [], Boolean)[0];
      if (gp) {
        // mismo mapeo que en partida: los mandos originales también mueven los menús
        var n = CP.Pads.read(gp), bits = 0;
        var pressed = function (i) { return (n.buttons >> i) & 1; };
        if (pressed(12) || n.ly < -0.6) bits |= 1;
        if (pressed(13) || n.ly > 0.6) bits |= 2;
        if (pressed(14) || n.lx < -0.6) bits |= 4;
        if (pressed(15) || n.lx > 0.6) bits |= 8;
        if (pressed(0)) bits |= 16;
        if (pressed(1)) bits |= 32;
        if (pressed(3)) bits |= 64;
        var now = Date.now(), fresh = bits & ~lastPad;
        if (bits & 15 && now > padRepeatAt) { fresh |= bits & 15; padRepeatAt = now + 180; }
        if (fresh & 1) CP.navMove('up');
        if (fresh & 2) CP.navMove('down');
        if (fresh & 4) CP.navMove('left');
        if (fresh & 8) CP.navMove('right');
        if (fresh & 16 && document.activeElement) document.activeElement.click();
        if (fresh & 32 && backHandler) backHandler();
        if (fresh & 64) secondary();
        if (!(bits & 15)) padRepeatAt = 0;
        lastPad = bits;
      }
    }
    root.requestAnimationFrame(poll);
  }
  root.requestAnimationFrame(poll);
})(window);
