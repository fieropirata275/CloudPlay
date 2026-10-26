/* Entrada: Gamepad API + teclado + mando de la tele -> paquetes binarios de estado (docs/PROTOCOL.md).
 * Se envía el ESTADO COMPLETO en cada cambio y como keepalive cada 100 ms, así que perder
 * paquetes en el canal unordered no deja botones pegados. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};

  var BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11,
              UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  CP.BTN = BTN;
  var MAX_PADS = 4, DEADZONE = 0.12, KEEPALIVE_MS = 100;

  function clamp16(v) {
    var n = Math.round(v * 32767);
    return n < -32768 ? -32768 : n > 32767 ? 32767 : n;
  }
  function clampU8(v) {
    var n = Math.round(v * 255);
    return n < 0 ? 0 : n > 255 ? 255 : n;
  }

  /** Paquete type=1 (16 bytes, little endian). st: {buttons, lx, ly, rx, ry (-1..1), lt, rt (0..1)} */
  CP.encodePad = function (pad, st, seq) {
    var buf = new ArrayBuffer(16), dv = new DataView(buf);
    dv.setUint8(0, 1);
    dv.setUint8(1, pad);
    dv.setUint16(2, st.buttons & 0xffff, true);
    dv.setInt16(4, clamp16(st.lx), true);
    dv.setInt16(6, clamp16(st.ly), true);
    dv.setInt16(8, clamp16(st.rx), true);
    dv.setInt16(10, clamp16(st.ry), true);
    dv.setUint8(12, clampU8(st.lt));
    dv.setUint8(13, clampU8(st.rt));
    dv.setUint16(14, seq & 0xffff, true);
    return buf;
  };
  /** Paquete type=2 (botón Guide/Home) */
  CP.encodeGuide = function (pad, pressed) {
    return new Uint8Array([2, pad, pressed ? 1 : 0, 0]).buffer;
  };

  function emptyState() { return { buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }; }
  function sameState(a, b) {
    return a.buttons === b.buttons && a.lx === b.lx && a.ly === b.ly && a.rx === b.rx &&
           a.ry === b.ry && a.lt === b.lt && a.rt === b.rt;
  }
  function stick(x, y) {
    var m = Math.sqrt(x * x + y * y);
    if (m < DEADZONE) return [0, 0];
    var s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
    return [Math.round(x * s * 1000) / 1000, Math.round(y * s * 1000) / 1000];
  }

  // keyCode -> botón. Se usa keyCode porque los navegadores viejos de las teles no tienen e.code.
  var KEYS_PC = {
    38: BTN.UP, 40: BTN.DOWN, 37: BTN.LEFT, 39: BTN.RIGHT,
    88: BTN.A, 90: BTN.B, 83: BTN.X, 65: BTN.Y,       // X Z S A
    81: BTN.LB, 87: BTN.RB, 49: BTN.LT, 50: BTN.RT,   // Q W 1 2
    13: BTN.START, 16: BTN.SELECT                    // Enter Shift
  };
  var KEYS_TV = {
    38: BTN.UP, 40: BTN.DOWN, 37: BTN.LEFT, 39: BTN.RIGHT,
    13: BTN.A,
    403: BTN.X, 404: BTN.Y, 405: BTN.LB, 406: BTN.RB, // rojo verde amarillo azul
    49: BTN.B, 50: BTN.SELECT, 51: BTN.START,          // 1 2 3
    415: BTN.START, 19: BTN.START, 10252: BTN.START    // play / pausa
  };
  CP.MENU_KEYS = { 27: 1, 8: 1, 461: 1, 10009: 1 };    // Esc, Backspace, Back webOS, Back Tizen

  /**
   * opts: { send(buf), onMenu(), isTV }
   */
  function InputManager(opts) {
    this.send = opts.send;
    this.onMenu = opts.onMenu || function () {};
    this.keymap = opts.isTV ? KEYS_TV : KEYS_PC;
    this.enabled = false;
    this.keyButtons = 0;
    this.last = [];
    this.seq = [];
    this.guide = [];
    this.comboSince = 0;
    this.touchState = null; // lo usa un overlay táctil si existe
    for (var i = 0; i < MAX_PADS; i++) { this.last[i] = emptyState(); this.seq[i] = 0; this.guide[i] = false; }
    this._onKey = this._onKey.bind(this);
    this._frame = this._frame.bind(this);
  }

  InputManager.prototype.start = function () {
    if (this.enabled) return;
    this.enabled = true;
    root.addEventListener('keydown', this._onKey, true);
    root.addEventListener('keyup', this._onKey, true);
    var self = this;
    this._keepalive = setInterval(function () { self._flush(true); }, KEEPALIVE_MS);
    this._raf = root.requestAnimationFrame(this._frame);
  };

  InputManager.prototype.stop = function () {
    this.enabled = false;
    root.removeEventListener('keydown', this._onKey, true);
    root.removeEventListener('keyup', this._onKey, true);
    clearInterval(this._keepalive);
    if (this._raf) root.cancelAnimationFrame(this._raf);
    this.keyButtons = 0;
    for (var i = 0; i < MAX_PADS; i++) {
      this.last[i] = emptyState();
      this._sendPad(i, this.last[i]);
    }
  };

  InputManager.prototype._onKey = function (e) {
    var code = e.keyCode;
    if (CP.MENU_KEYS[code]) {
      // stopPropagation: si no, este mismo evento llega al listener de navegación
      // (que se activa al abrir el menú) y lo cierra al instante.
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'keydown' && !e.repeat) this.onMenu();
      return;
    }
    var b = this.keymap[code];
    if (b === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'keydown') this.keyButtons |= (1 << b);
    else this.keyButtons &= ~(1 << b);
    this._flush(false);
  };

  InputManager.prototype._frame = function () {
    if (!this.enabled) return;
    this._flush(false);
    this._raf = root.requestAnimationFrame(this._frame);
  };

  InputManager.prototype._readPads = function () {
    var out = [], list = (root.navigator.getGamepads && root.navigator.getGamepads()) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].connected !== false) out.push(list[i]);
    return out.slice(0, MAX_PADS);
  };

  // Cualquier mando (estándar, con perfil o configurado con el asistente) pasa por CP.Pads (js/pads.js)
  InputManager.prototype._stateFrom = function (gp) {
    var n = CP.Pads.read(gp), st = emptyState();
    st.buttons = n.buttons;
    st.lt = n.lt; st.rt = n.rt;
    var l = stick(n.lx, n.ly), r = stick(n.rx, n.ry);
    st.lx = l[0]; st.ly = l[1]; st.rx = r[0]; st.ry = r[1];
    st._guide = n.guide;
    return st;
  };

  InputManager.prototype._flush = function (force) {
    if (!this.enabled) return;
    var pads = this._readPads(), now = Date.now(), menuCombo = false;
    for (var i = 0; i < MAX_PADS; i++) {
      var st = pads[i] ? this._stateFrom(pads[i]) : emptyState();
      if (i === 0) {
        st.buttons |= this.keyButtons;
        if (this.touchState) {
          var t = this.touchState;
          st.buttons |= t.buttons;
          if (!st.lx && !st.ly) { st.lx = t.lx; st.ly = t.ly; }
        }
      }
      if (st._guide !== undefined) {
        if (st._guide !== this.guide[i]) { this.guide[i] = st._guide; this.send(CP.encodeGuide(i, st._guide)); }
        delete st._guide;
      }
      var sel = (1 << BTN.SELECT) | (1 << BTN.START);
      if ((st.buttons & sel) === sel) menuCombo = true;
      if (!pads[i] && i > 0 && sameState(st, this.last[i])) continue;
      if (force || !sameState(st, this.last[i])) {
        this.last[i] = st;
        this._sendPad(i, st);
      }
    }
    // Select + Start mantenidos 1 s -> menú (para quien solo tiene mando)
    if (menuCombo) {
      if (!this.comboSince) this.comboSince = now;
      else if (now - this.comboSince > 1000) { this.comboSince = 0; this.onMenu(); }
    } else this.comboSince = 0;
  };

  InputManager.prototype._sendPad = function (i, st) {
    this.seq[i] = (this.seq[i] + 1) & 0xffff;
    this.send(CP.encodePad(i, st, this.seq[i]));
  };

  CP.InputManager = InputManager;
  if (typeof module !== 'undefined') module.exports = CP;
})(typeof window !== 'undefined' ? window : globalThis);
