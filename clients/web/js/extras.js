/* Accesorios de la partida: lo que el jugador tiene en su ordenador (micro, cámara, teclado, ratón, mandos)
 * hace de accesorio de la consola de la nube. Se eligen al lanzar el juego (se sugieren por el título) o desde
 * el menú de la partida, y se recuerdan por juego en este dispositivo. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var $ = function (s) { return document.querySelector(s); };
  var h = null;

  // id, nombre, qué usa de tu ordenador, ¿va en un puerto USB de la PS2?
  var LIST = {
    ps2: [
      ['singstar', 'Micros de SingStar', 'Cantas con el micro de tu ordenador', 1],
      ['eyetoy', 'EyeToy', 'Tu cámara hace de EyeToy', 1],
      ['buzz', 'Pulsadores Buzz!', 'Hasta 4 jugadores con mandos (rojo = ✕/A) o tus Buzz! USB', 1],
      ['guitar', 'Guitarra de Guitar Hero', 'Tu guitarra USB o un mando, en el puerto 1', 0],
      ['drums', 'Batería USB', 'Rock Band y Guitar Hero World Tour', 1],
      ['guncon2', 'Pistola GunCon 2', 'Apuntas con el ratón y disparas con clic', 1],
      ['usb_keyboard', 'Teclado USB', 'Tu teclado tal cual', 1],
      ['usb_mouse', 'Ratón USB', 'Tu ratón tal cual', 1],
      ['headset', 'Auriculares USB', 'Chat de voz con el micro de tu ordenador', 1]
    ],
    gc: [
      ['gc_bongos', 'Bongos de DK', 'Donkey Konga y Jungle Beat: los bongos con adaptador o un mando', 0],
      ['gc_mic', 'Micrófono', 'Mario Party 6 y 7: el micro de tu ordenador', 0],
      ['gc_dancemat', 'Alfombra de baile', 'DDR Mario Mix: tu alfombra USB o un mando', 0],
      ['gc_keyboard', 'Teclado', 'Phantasy Star Online: tu teclado', 0]
    ],
    wii: []
  };
  var HINTS = [
    [/singstar|karaoke/i, ['singstar']], [/eye ?toy/i, ['eyetoy']], [/\bbuzz\b/i, ['buzz']],
    [/guitar hero|band hero/i, ['guitar']], [/rock band|world tour/i, ['guitar', 'drums']],
    [/time crisis|point blank|vampire night|ninja assault|dead aim|starsky/i, ['guncon2']],
    [/donkey konga|jungle beat/i, ['gc_bongos']], [/mario party (6|7)/i, ['gc_mic']],
    [/dance ?dance|ddr|mario mix/i, ['gc_dancemat']], [/phantasy star online/i, ['gc_keyboard']]
  ];
  var MIC = { singstar: 1, headset: 1, gc_mic: 1 }, CAM = { eyetoy: 1 };

  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} }

  function suggested(game) {
    var out = [];
    HINTS.forEach(function (x) {
      if (x[0].test(game.title || '')) x[1].forEach(function (a) { if (out.indexOf(a) < 0 && known(game, a)) out.push(a); });
    });
    return out;
  }
  function known(game, id) { return (LIST[game.platform] || []).some(function (x) { return x[0] === id; }); }
  function saved(game) {
    var s = lsGet('cp.acc.' + game.id);
    if (s === null) return null;
    try { return JSON.parse(s).filter(function (a) { return known(game, a); }); } catch (e) { return null; }
  }
  function toOptions(list) {
    return {
      accessories: list.slice(0, 4),
      mic: list.some(function (a) { return MIC[a]; }),
      camera: list.some(function (a) { return CAM[a]; })
    };
  }
  /** Qué necesita capturar el cliente durante la partida */
  function needs(options) {
    var a = (options && options.accessories) || [];
    return {
      keyboard: a.indexOf('usb_keyboard') >= 0 || a.indexOf('gc_keyboard') >= 0,
      mouse: a.indexOf('usb_mouse') >= 0 || a.indexOf('guncon2') >= 0,
      gun: a.indexOf('guncon2') >= 0
    };
  }

  // ------------------------------------------------------------------ hoja
  var pending = null;
  function render(game, chosen) {
    var box = $('#acc-list');
    box.innerHTML = '';
    (LIST[game.platform] || []).forEach(function (x) {
      var b = document.createElement('button');
      b.className = 'btn acc' + (chosen.indexOf(x[0]) >= 0 ? ' on' : '');
      b.setAttribute('aria-pressed', chosen.indexOf(x[0]) >= 0 ? 'true' : 'false');
      b.setAttribute('data-acc', x[0]);
      b.innerHTML = '<b></b><small></small>';
      b.firstChild.textContent = x[1];
      b.lastChild.textContent = x[2];
      box.appendChild(b);
    });
  }
  function chosenNow() {
    return Array.prototype.map.call(document.querySelectorAll('#acc-list .acc.on'), function (b) { return b.getAttribute('data-acc'); });
  }
  function usbCount(game, list) {
    return list.filter(function (a) { return (LIST[game.platform] || []).some(function (x) { return x[0] === a && x[3]; }); }).length;
  }

  /** Abre la hoja. Devuelve una promesa con la lista elegida o null si se cancela. */
  function pick(game, opts) {
    opts = opts || {};
    var start = saved(game);
    if (start === null) start = suggested(game);
    $('#acc-game').textContent = game.title;
    $('#acc-go').textContent = opts.restart ? 'Reiniciar con estos accesorios' : 'Jugar';
    $('#acc-note').textContent = opts.restart ? 'La partida se reinicia: guarda antes si estás a mitad.' : '';
    render(game, start);
    h.openSheet($('#acc-sheet'));
    CP.navSetActive(true);
    setTimeout(function () { var f = $('#acc-go'); if (f) f.focus(); }, 60);
    return new Promise(function (resolve) {
      pending = function (list) {
        pending = null;
        h.closeSheet($('#acc-sheet'));
        if (list) lsSet('cp.acc.' + game.id, JSON.stringify(list));
        resolve(list);
      };
      CP.navOnBack(function () { if (pending) pending(null); });
      $('#acc-list').onclick = function (e) {
        var b = e.target;
        while (b && b !== this && !(b.getAttribute && b.getAttribute('data-acc'))) b = b.parentNode;
        if (!b || b === this) return;
        var on = !b.classList.contains('on');
        var next = chosenNow().filter(function (a) { return a !== b.getAttribute('data-acc'); });
        if (on) next.push(b.getAttribute('data-acc'));
        if (on && game.platform === 'ps2' && usbCount(game, next) > 2) { h.toast('La PS2 tiene 2 puertos USB: quita uno antes'); return; }
        if (on && next.length > 4) { h.toast('Como mucho 4 accesorios a la vez'); return; }
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
    });
  }

  /** Opciones de sesión para lanzar un juego; null si el jugador cancela */
  function optionsFor(game, force) {
    var list = saved(game), sugg = suggested(game);
    var ask = force || (LIST[game.platform] || []).length && (sugg.length || (list && list.length));
    if (!ask) return Promise.resolve(toOptions(list || []));
    return pick(game).then(function (l) { return l === null ? null : toOptions(l); });
  }

  function init(helpers) {
    h = helpers;
    $('#acc-go').addEventListener('click', function () { if (pending) pending(chosenNow()); });
    $('#acc-none').addEventListener('click', function () { if (pending) pending([]); });
    $('#acc-cancel').addEventListener('click', function () { if (pending) pending(null); });
  }

  CP.Extras = { init: init, optionsFor: optionsFor, pick: pick, needs: needs, has: function (game) { return (LIST[game.platform] || []).length > 0; },
                suggested: suggested, toOptions: toOptions, LIST: LIST };
})(window);
