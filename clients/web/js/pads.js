/* Mandos: cualquier mando (también los originales de PS2 y GameCube con adaptador USB) se traduce al
 * "standard gamepad" del W3C, que es lo que entiende el protocolo.
 *  1. Mapeo propio del usuario (asistente "Configurar mando"), guardado por mando en este dispositivo.
 *  2. El navegador ya lo da como estándar (Xbox, DualShock 4, DualSense...).
 *  3. Perfil de la base de SDL_GameControllerDB (js/padsdb.js, se carga solo cuando hace falta).
 *  4. Sin perfil: se lee tal cual y se avisa para configurarlo.
 * Tokens de un mapeo: bN botón · aN eje · aN~ invertido · aN+ / aN- medio eje · aN:R:E gatillo (reposo R, fondo E)
 * · aN=V eje con un valor (cruceta en un eje) · hM bit M del hat (dónde está el hat lo decide la plataforma)
 * · hK.M hat en el eje K. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var STORE = 'cp.pad.';
  var ua = (root.navigator && root.navigator.userAgent) || '';
  // Columna de la base de perfiles: 1 Windows, 2 macOS, 3 Linux. Android: sin base (usa el asistente).
  var PLAT = /Android/.test(ua) ? 0 : /Windows/.test(ua) ? 1 : /Mac OS X|Macintosh/.test(ua) ? 2 : /Linux|CrOS/.test(ua) ? 3 : 1;
  var GUIDE = 16;

  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) {} }

  /** "vvvvpppp" a partir del id del navegador (Chrome: "Vendor: 0079 Product: 1846"; Firefox: "79-1846-…"). */
  function vidpid(id) {
    var m = /Vendor:\s*([0-9a-f]{1,4})\s*Product:\s*([0-9a-f]{1,4})/i.exec(id || '') || /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id || '');
    if (!m) return null;
    return ('0000' + m[1]).slice(-4).toLowerCase() + ('0000' + m[2]).slice(-4).toLowerCase();
  }

  // ------------------------------------------------------------------ base de perfiles (carga perezosa)
  var dbState = CP.PADS_DB ? 'ok' : 'none', dbWaiters = [];
  function ensureDb(cb) {
    if (dbState === 'ok') { if (cb) cb(); return; }
    if (cb) dbWaiters.push(cb);
    if (dbState === 'loading') return;
    dbState = 'loading';
    var s = document.createElement('script');
    s.src = 'js/padsdb.js';
    s.onload = function () { dbState = CP.PADS_DB ? 'ok' : 'none'; flushWaiters(); };
    s.onerror = function () { dbState = 'none'; flushWaiters(); };
    document.head.appendChild(s);
  }
  function flushWaiters() { var w = dbWaiters; dbWaiters = []; for (var i = 0; i < w.length; i++) w[i](); }

  function profileFor(id) {
    if (!PLAT || !CP.PADS_DB) return null;
    var k = vidpid(id), e = k && CP.PADS_DB[k];
    return e && e[PLAT] ? { name: e[0], map: e[PLAT] } : null;
  }

  // ------------------------------------------------------------------ lectura
  function btnVal(gp, i) {
    var b = gp.buttons[i];
    if (!b) return 0;
    if (typeof b !== 'object') return b;
    // gatillos analógicos: su valor real; botones digitales que no rellenan value: pulsado = 1
    return b.value > 0 ? b.value : b.pressed ? 1 : 0;
  }
  function ax(gp, i) { var v = gp.axes[i]; return typeof v === 'number' ? v : 0; }

  /** Hat de 8 posiciones codificado en un eje (Chrome en Windows/macOS): -1 arriba … 1 arriba-izquierda, >1 suelto */
  var HAT8 = [1, 3, 2, 6, 4, 12, 8, 9];
  function hatFromAxis(v) {
    if (v < -1.05 || v > 1.05) return 0;
    return HAT8[Math.round((v + 1) * 3.5) & 7];
  }
  function hatBits(gp, axisIndex) {
    var n = gp.axes.length;
    if (axisIndex !== undefined) return hatFromAxis(ax(gp, axisIndex));
    if (PLAT === 3 && n >= 2) {  // Linux: el hat son los dos últimos ejes
      var x = ax(gp, n - 2), y = ax(gp, n - 1), bits = 0;
      if (y < -0.5) bits |= 1; if (x > 0.5) bits |= 2; if (y > 0.5) bits |= 4; if (x < -0.5) bits |= 8;
      return bits;
    }
    return n > 9 ? hatFromAxis(ax(gp, 9)) : n ? hatFromAxis(ax(gp, n - 1)) : 0;
  }

  /** Token -> función(gp) que da 0..1 (botones/gatillos) o -1..1 (ejes de stick) */
  function compileToken(tok, asStick) {
    var m;
    if ((m = /^b(\d+)$/.exec(tok))) { var bi = +m[1]; return function (gp) { return btnVal(gp, bi); }; }
    if ((m = /^h(\d+)\.(\d+)$/.exec(tok))) { var hk = +m[1], hm = +m[2]; return function (gp) { return hatBits(gp, hk) & hm ? 1 : 0; }; }
    if ((m = /^h(\d+)$/.exec(tok))) { var mask = +m[1]; return function (gp) { return hatBits(gp) & mask ? 1 : 0; }; }
    if ((m = /^a(\d+):(-?[\d.]+):(-?[\d.]+)$/.exec(tok))) {
      var ti = +m[1], rest = +m[2], end = +m[3];
      return function (gp) { var t = (ax(gp, ti) - rest) / (end - rest); return t < 0 ? 0 : t > 1 ? 1 : t; };
    }
    if ((m = /^a(\d+)=(-?[\d.]+)$/.exec(tok))) {
      var ei = +m[1], ev = +m[2];
      return function (gp) { return Math.abs(ax(gp, ei) - ev) < 0.12 ? 1 : 0; };
    }
    if ((m = /^a(\d+)([+-]?)(~?)$/.exec(tok))) {
      var ai = +m[1], half = m[2], inv = m[3] ? -1 : 1;
      if (half === '+') return function (gp) { return Math.max(0, ax(gp, ai) * inv); };
      if (half === '-') return function (gp) { return Math.max(0, -ax(gp, ai) * inv); };
      if (asStick) return function (gp) { return ax(gp, ai) * inv; };
      // eje completo usado como gatillo o botón: -1..1 -> 0..1
      return function (gp) { return (ax(gp, ai) * inv + 1) / 2; };
    }
    return null;
  }

  var cache = {};
  function compile(str) {
    if (cache[str]) return cache[str];
    var c = { btn: [], lx: null, ly: null, rx: null, ry: null, lt: null, rt: null };
    String(str).split(',').forEach(function (pair) {
      var i = pair.indexOf(':');
      if (i < 0) return;
      var slot = pair.slice(0, i), tok = pair.slice(i + 1);
      var stick = slot === 'lx' || slot === 'ly' || slot === 'rx' || slot === 'ry';
      var fn = compileToken(tok, stick);
      if (!fn) return;
      if (/^\d+$/.test(slot)) c.btn.push([+slot, fn]);
      else c[slot] = fn;
    });
    cache[str] = c;
    return c;
  }

  function customKey(gp) { return STORE + gp.id; }
  function customFor(gp) { return lsGet(customKey(gp)); }

  /** De dónde sale el mapeo de este mando: {kind: custom|standard|profile|unknown, name, map} */
  function describe(gp) {
    var c = customFor(gp);
    if (c) return { kind: 'custom', name: niceName(gp), map: c };
    if (gp.mapping === 'standard') return { kind: 'standard', name: niceName(gp) };
    if (dbState !== 'ok') ensureDb();
    var p = profileFor(gp.id);
    if (p) return { kind: 'profile', name: p.name, map: p.map };
    return { kind: 'unknown', name: niceName(gp) };
  }
  function niceName(gp) {
    return String(gp.id || 'Mando').replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor:.*\)\s*$/i, '').replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '') || 'Mando';
  }

  // Buzz! (Sony 054c:0002 con cable, 054c:1000 inalámbrico): 4 pulsadores en un solo dispositivo de 20 botones,
  // 5 por jugador en orden rojo, amarillo, verde, naranja, azul. Se reparten como 4 mandos:
  // rojo ✕/A, naranja ◯/B, verde □/X, azul △/Y, amarillo L1/LB (lo que espera PCSX2 para el Buzz)
  var BUZZ_BITS = [0, 4, 2, 1, 3];
  function isBuzz(gp) {
    var k = vidpid(gp.id);
    return k === '054c0002' || k === '054c1000';
  }
  function players(list) {
    var out = [];
    list.forEach(function (gp) {
      if (!isBuzz(gp)) { out.push(gp); return; }
      for (var p = 0; p < 4; p++) out.push({ buzz: gp, player: p, id: gp.id + ' #' + (p + 1), index: gp.index * 4 + p, mapping: 'buzz', buttons: [], axes: [] });
    });
    return out;
  }
  function readBuzz(v) {
    var st = { buttons: 0, guide: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
    for (var i = 0; i < 5; i++) if (btnVal(v.buzz, v.player * 5 + i) > 0.5) st.buttons |= (1 << BUZZ_BITS[i]);
    return st;
  }

  /**
   * Estado normalizado de un mando: {buttons (bits 0..15), guide, lx, ly, rx, ry (-1..1 sin zona muerta), lt, rt (0..1)}
   */
  function read(gp) {
    if (gp.buzz) return readBuzz(gp);
    var st = { buttons: 0, guide: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
    var d = describe(gp);
    if (d.map) {
      var c = compile(d.map);
      for (var i = 0; i < c.btn.length; i++) {
        var slot = c.btn[i][0], v = c.btn[i][1](gp);
        if (v > 0.5) { if (slot === GUIDE) st.guide = true; else st.buttons |= (1 << slot); }
      }
      st.lx = c.lx ? c.lx(gp) : 0; st.ly = c.ly ? c.ly(gp) : 0;
      st.rx = c.rx ? c.rx(gp) : 0; st.ry = c.ry ? c.ry(gp) : 0;
      st.lt = c.lt ? c.lt(gp) : 0; st.rt = c.rt ? c.rt(gp) : 0;
    } else {
      var b = gp.buttons;
      for (var j = 0; j < 16 && j < b.length; j++) {
        if (j === 6 || j === 7) continue;
        if (btnVal(gp, j) > 0.5) st.buttons |= (1 << j);
      }
      st.lt = b[6] ? btnVal(gp, 6) : 0;
      st.rt = b[7] ? btnVal(gp, 7) : 0;
      st.lx = ax(gp, 0); st.ly = ax(gp, 1); st.rx = ax(gp, 2); st.ry = ax(gp, 3);
      st.guide = btnVal(gp, GUIDE) > 0.5;
    }
    if (st.lt > 0.5) st.buttons |= (1 << 6);
    if (st.rt > 0.5) st.buttons |= (1 << 7);
    return st;
  }

  function list() {
    var out = [], l = (root.navigator.getGamepads && root.navigator.getGamepads()) || [];
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].connected !== false) out.push(l[i]);
    return out;
  }
  function find(index) {
    var l = list();
    for (var i = 0; i < l.length; i++) if (l[i].index === index) return l[i];
    return null;
  }

  // ------------------------------------------------------------------ asistente
  // Cada consola nombra los botones a su manera; el destino es el bit "standard" que el emulador espera
  // (Dolphin: A=Sur, B=Oeste, X=Este, Y=Norte, Z=RB; PCSX2: ✕ Sur, ◯ Este, □ Oeste, △ Norte).
  var LAYOUTS = {
    ps2: {
      title: 'Mando de PS2 (DualShock 2)',
      steps: [
        ['0', '✕ Cruz'], ['1', '◯ Círculo'], ['2', '□ Cuadrado'], ['3', '△ Triángulo'],
        ['4', 'L1'], ['5', 'R1'], ['lt', 'L2'], ['rt', 'R2'], ['8', 'SELECT'], ['9', 'START'],
        ['12', 'Cruceta ↑'], ['13', 'Cruceta ↓'], ['14', 'Cruceta ←'], ['15', 'Cruceta →'],
        ['lx', 'Stick izquierdo hacia la DERECHA'], ['ly', 'Stick izquierdo hacia ABAJO'],
        ['rx', 'Stick derecho hacia la DERECHA', 1], ['ry', 'Stick derecho hacia ABAJO', 1],
        ['10', 'L3 (hunde el stick izquierdo)', 1], ['11', 'R3 (hunde el stick derecho)', 1], ['16', 'Botón ANALOG / Home', 1]
      ]
    },
    gc: {
      title: 'Mando de GameCube',
      steps: [
        ['0', 'A (el grande verde)'], ['2', 'B (el rojo)'], ['1', 'X'], ['3', 'Y'], ['5', 'Z'],
        ['lt', 'Gatillo L (hasta el fondo)'], ['rt', 'Gatillo R (hasta el fondo)'], ['9', 'START'],
        ['12', 'Cruceta ↑'], ['13', 'Cruceta ↓'], ['14', 'Cruceta ←'], ['15', 'Cruceta →'],
        ['lx', 'Stick de control hacia la DERECHA'], ['ly', 'Stick de control hacia ABAJO'],
        ['rx', 'C-Stick (amarillo) hacia la DERECHA'], ['ry', 'C-Stick (amarillo) hacia ABAJO'],
        ['16', 'Botón Home del adaptador', 1]
      ]
    },
    std: {
      title: 'Otro mando (distribución Xbox)',
      steps: [
        ['0', 'A / botón de abajo'], ['1', 'B / botón de la derecha'], ['2', 'X / botón de la izquierda'], ['3', 'Y / botón de arriba'],
        ['4', 'LB / L1'], ['5', 'RB / R1'], ['lt', 'LT / L2'], ['rt', 'RT / R2'], ['8', 'Back / Select'], ['9', 'Start'],
        ['12', 'Cruceta ↑'], ['13', 'Cruceta ↓'], ['14', 'Cruceta ←'], ['15', 'Cruceta →'],
        ['lx', 'Stick izquierdo hacia la DERECHA'], ['ly', 'Stick izquierdo hacia ABAJO'],
        ['rx', 'Stick derecho hacia la DERECHA', 1], ['ry', 'Stick derecho hacia ABAJO', 1],
        ['10', 'Hunde el stick izquierdo', 1], ['11', 'Hunde el stick derecho', 1], ['16', 'Botón Guide / Home', 1]
      ]
    }
  };
  // Nombres por consola para la prueba en vivo (índice standard -> etiqueta)
  var LABELS = {
    ps2: ['✕', '◯', '□', '△', 'L1', 'R1', 'L2', 'R2', 'SELECT', 'START', 'L3', 'R3', '↑', '↓', '←', '→', 'HOME'],
    gc: ['A', 'X', 'B', 'Y', '', 'Z', 'L', 'R', '', 'START', '', '', '↑', '↓', '←', '→', 'HOME'],
    std: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'L3', 'R3', '↑', '↓', '←', '→', 'GUIDE']
  };

  function snapshot(gp) {
    var s = { b: [], a: [] };
    for (var i = 0; i < gp.buttons.length; i++) s.b.push(btnVal(gp, i));
    for (var j = 0; j < gp.axes.length; j++) s.a.push(ax(gp, j));
    return s;
  }
  /** Todo suelto: ningún botón pulsado y los ejes donde estaban en reposo */
  function atRest(gp, rest) {
    for (var i = 0; i < gp.buttons.length; i++) if (btnVal(gp, i) > 0.5) return false;
    for (var j = 0; j < gp.axes.length; j++) if (Math.abs(ax(gp, j) - (rest.a[j] || 0)) > 0.25) return false;
    return true;
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  /** Qué ha hecho el jugador respecto al reposo, como token para ese destino (o null si nada claro) */
  function detect(gp, base, slot, used) {
    var stick = slot === 'lx' || slot === 'ly' || slot === 'rx' || slot === 'ry';
    var trig = slot === 'lt' || slot === 'rt';
    if (!stick) {
      for (var i = 0; i < gp.buttons.length; i++) {
        if (btnVal(gp, i) > 0.6 && !(base.b[i] > 0.5) && !used['b' + i]) return 'b' + i;
      }
    }
    var best = -1, delta = 0;
    for (var j = 0; j < gp.axes.length; j++) {
      var d = ax(gp, j) - (base.a[j] || 0);
      if (Math.abs(d) > Math.abs(delta)) { delta = d; best = j; }
    }
    if (best < 0 || Math.abs(delta) < 0.55) return null;
    var v = ax(gp, best), rest = base.a[best] || 0;
    if (stick) {
      if (used['a' + best]) return null;
      return 'a' + best + (delta > 0 ? '' : '~');
    }
    // Eje que reposa fuera de -1..1: cruceta codificada en un eje (hat)
    if (Math.abs(rest) > 1.05) return 'a' + best + '=' + round2(v);
    if (trig) return 'a' + best + ':' + round2(rest) + ':' + (delta > 0 ? 1 : -1);
    return 'a' + best + (delta > 0 ? '+' : '-');
  }

  /** Si la cruceta quedó como 4 valores de un mismo eje, se pasa a hat de 8 posiciones (diagonales incluidas) */
  function tidy(map) {
    var dirs = { 12: 1, 13: 4, 14: 8, 15: 2 }, axis = null, ok = true, k;
    for (k in dirs) {
      var t = map[k], m = t && /^a(\d+)=/.exec(t);
      if (!m || (axis !== null && axis !== m[1])) { ok = false; break; }
      axis = m[1];
    }
    if (ok && axis !== null) {
      var probe = { axes: [] };
      for (k in dirs) {
        probe.axes[+axis] = parseFloat(map[k].split('=')[1]);
        if (hatFromAxis(probe.axes[+axis]) !== dirs[k]) { ok = false; break; }
      }
      if (ok) for (k in dirs) map[k] = 'h' + axis + '.' + dirs[k];
    }
    var out = [];
    for (k in map) out.push(k + ':' + map[k]);
    return out.join(',');
  }

  /**
   * Asistente: opts {index, layout, onStep(step, i, total), onDone(mapStr), onCancel()}
   * Pide cada botón; espera a que se suelte todo antes del siguiente. Los pasos opcionales se saltan solos.
   */
  function Wizard(opts) {
    this.o = opts;
    this.steps = LAYOUTS[opts.layout].steps;
    this.i = -1;
    this.map = {};
    this.used = {};
    this._tick = this._tick.bind(this);
  }
  Wizard.prototype.start = function () {
    var gp = find(this.o.index);
    this.rest = gp ? snapshot(gp) : null;  // el mando sin tocar: referencia de reposo
    this._next();
    this._raf = root.requestAnimationFrame(this._tick);
  };
  Wizard.prototype.stop = function () { this.stopped = true; if (this._raf) root.cancelAnimationFrame(this._raf); clearTimeout(this._auto); };
  Wizard.prototype.skip = function () { this._next(); };
  Wizard.prototype.back = function () {
    if (this.i <= 0) return;
    var prev = this.steps[this.i - 1][0];
    if (this.map[prev]) { delete this.used[this.map[prev].replace(/[~+-].*$|[:=].*$/, '')]; delete this.map[prev]; }
    this.i -= 2;
    this._next();
  };
  Wizard.prototype._next = function () {
    clearTimeout(this._auto);
    this.i++;
    this.waitRelease = true;
    if (this.i >= this.steps.length) { this.stop(); this.o.onDone(tidy(this.map)); return; }
    var st = this.steps[this.i], self = this;
    this.o.onStep({ slot: st[0], label: st[1], optional: !!st[2] }, this.i, this.steps.length);
    if (st[2]) this._auto = setTimeout(function () { self._next(); }, 9000);
  };
  Wizard.prototype._tick = function () {
    if (this.stopped) return;
    var gp = find(this.o.index);
    if (gp && !this.rest) this.rest = snapshot(gp);
    if (gp) {
      if (this.waitRelease) {
        // hasta que no se suelta todo no empieza el paso: soltar el stick del paso anterior no cuenta
        if (atRest(gp, this.rest)) { this.waitRelease = false; this.base = snapshot(gp); }
      } else {
        var slot = this.steps[this.i][0], tok = detect(gp, this.base, slot, this.used);
        if (tok) {
          this.map[slot] = tok;
          this.used[tok.replace(/[~+-]$|[:=].*$/, '')] = 1;
          this._next();
        }
      }
    }
    this._raf = root.requestAnimationFrame(this._tick);
  };

  // ------------------------------------------------------------------ avisos al conectar
  var listeners = [];
  if (root.addEventListener) {
    root.addEventListener('gamepadconnected', function (e) {
      var gp = e.gamepad;
      if (!gp || gp.mapping === 'standard' || customFor(gp)) return notify(gp);
      ensureDb(function () { notify(find(gp.index) || gp); });
    });
  }
  function notify(gp) { var d = describe(gp); for (var i = 0; i < listeners.length; i++) listeners[i](gp, d); }

  CP.Pads = {
    read: read,
    list: list,
    players: players,
    isBuzz: isBuzz,
    find: find,
    describe: describe,
    ensureDb: ensureDb,
    vidpid: vidpid,
    hatFromAxis: hatFromAxis,
    compile: compile,
    detect: detect,
    tidy: tidy,
    snapshot: snapshot,
    Wizard: Wizard,
    LAYOUTS: LAYOUTS,
    LABELS: LABELS,
    save: function (gp, map) { lsSet(customKey(gp), map); },
    reset: function (gp) { lsSet(customKey(gp), null); },
    onConnect: function (fn) { listeners.push(fn); },
    _setPlatform: function (p) { PLAT = p; }
  };
  if (typeof module !== 'undefined') module.exports = CP.Pads;
})(typeof window !== 'undefined' ? window : globalThis);
