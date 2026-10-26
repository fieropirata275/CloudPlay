/* Wiimote y Balance Board REALES conectados al ordenador del jugador (Bluetooth del PC o una DolphinBar),
 * leídos con WebHID (Chrome / Edge de escritorio y la app de escritorio) y enviados a la consola de la nube,
 * informe a informe: Dolphin cree que están conectados a ella (worker/session/cloudplay/hidbridge.py).
 * Puntero IR, altavoz, vibración, LEDs, MotionPlus, Nunchuk, Classic, guitarras... y la Balance Board. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var hid = root.navigator && root.navigator.hid;
  var FILTERS = [{ vendorId: 0x057e, productId: 0x0306 }, { vendorId: 0x057e, productId: 0x0330 }];
  var LINK = 1, UNLINK = 2, REPORT = 3, STATE = 4;
  // Tamaño exacto de cada informe de salida del Wiimote (sin el ID): Windows rechaza los que no cuadran
  var OUT_LEN = { 0x10: 1, 0x11: 1, 0x12: 2, 0x13: 1, 0x14: 1, 0x15: 1, 0x16: 21, 0x17: 6, 0x18: 21, 0x19: 1, 0x1a: 1 };

  function isWii(d) {
    return d && d.vendorId === 0x057e && (d.productId === 0x0306 || d.productId === 0x0330);
  }
  function kindOf(d) { return /RVL-WBC|balance/i.test(d.productName || '') ? 1 : 0; }
  function label(d) { return kindOf(d) ? 'Balance Board' : 'Wiimote'; }

  /** Dispositivos que el jugador ya autorizó (WebHID los recuerda) */
  function known() {
    if (!hid) return Promise.resolve([]);
    return hid.getDevices().then(function (l) { return l.filter(isWii); }).catch(function () { return []; });
  }
  /** Añadir uno: tiene que llamarse desde un clic (WebHID abre su selector) */
  function add() {
    if (!hid) return Promise.reject(new Error('Este navegador no puede usar el Wiimote: abre CloudPlay en Chrome o Edge en tu ordenador.'));
    return hid.requestDevice({ filters: FILTERS }).then(function (l) { return l.filter(isWii); });
  }
  function forget(d) {
    var p = d.opened ? d.close() : Promise.resolve();
    return p.then(function () { return d.forget ? d.forget() : null; });
  }
  function open(d) { return d.opened ? Promise.resolve(d) : d.open().then(function () { return d; }); }

  function sendOut(d, rid, data) {
    var n = OUT_LEN[rid], buf = data;
    if (n !== undefined && data.length !== n) {
      buf = new Uint8Array(n);
      buf.set(data.subarray(0, Math.min(n, data.length)));
    }
    return d.sendReport(rid, buf).catch(function () {});
  }

  // Botones del núcleo del Wiimote (2 primeros bytes de casi todos los informes de entrada)
  var BTN = [[0, 0x08, '↑'], [0, 0x04, '↓'], [0, 0x01, '←'], [0, 0x02, '→'], [1, 0x08, 'A'], [1, 0x04, 'B'],
             [1, 0x02, '1'], [1, 0x01, '2'], [1, 0x10, '−'], [0, 0x10, '+'], [1, 0x80, 'HOME']];
  function buttonsOf(rid, bytes) {
    if (!((rid >= 0x20 && rid <= 0x22) || (rid >= 0x30 && rid <= 0x37)) || bytes.length < 2) return null;
    return BTN.filter(function (b) { return bytes[b[0]] & b[1]; }).map(function (b) { return b[2]; });
  }

  // ------------------------------------------------------------------ en partida
  /**
   * Conecta los dispositivos vinculados con la sesión.
   * o: { sendReliable(buf), sendFast(buf), onState(info) } -> devuelve { onMessage(buf), stop() }
   * info: { id, kind: 'wiimote'|'board', connected, name }
   */
  function attach(o) {
    var byId = [], stopped = false;

    function idOf(d) { for (var i = 0; i < byId.length; i++) if (byId[i] === d) return i; return -1; }
    function link(d) {
      if (stopped || idOf(d) >= 0) return;
      var free = byId.indexOf(null);
      var id = free >= 0 ? free : byId.length;
      if (id > 7) return;
      byId[id] = d;
      open(d).then(function () {
        if (stopped || byId[id] !== d) return;
        d.oninputreport = function (e) {
          var data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
          var msg = new Uint8Array(3 + data.length);
          msg[0] = REPORT; msg[1] = id; msg[2] = e.reportId;
          msg.set(data, 3);
          // botones/IR/movimiento continuos: canal rápido; respuestas de memoria, acks y estado: fiable
          if (e.reportId >= 0x30 && e.reportId <= 0x3f) o.sendFast(msg.buffer); else o.sendReliable(msg.buffer);
        };
        o.sendReliable(new Uint8Array([LINK, id, kindOf(d)]).buffer);
      }).catch(function () { byId[id] = null; });
    }
    function unlink(d) {
      var id = idOf(d);
      if (id < 0) return;
      byId[id] = null;
      d.oninputreport = null;
      o.sendReliable(new Uint8Array([UNLINK, id]).buffer);
      o.onState({ id: id, kind: kindOf(d) ? 'board' : 'wiimote', connected: false, name: label(d) });
    }

    function onConnect(e) { if (isWii(e.device)) link(e.device); }
    function onDisconnect(e) { if (isWii(e.device)) unlink(e.device); }
    if (hid) {
      hid.addEventListener('connect', onConnect);
      hid.addEventListener('disconnect', onDisconnect);
    }
    known().then(function (l) { l.forEach(link); });

    return {
      onMessage: function (buf) {
        var b = new Uint8Array(buf);
        if (b.length < 3) return;
        var d = byId[b[1]];
        if (!d) return;
        if (b[0] === REPORT && b.length >= 3) sendOut(d, b[2], b.subarray(3));
        else if (b[0] === STATE) o.onState({ id: b[1], kind: kindOf(d) ? 'board' : 'wiimote', connected: !!b[2], name: label(d) });
      },
      link: link,
      stop: function () {
        stopped = true;
        if (hid) {
          hid.removeEventListener('connect', onConnect);
          hid.removeEventListener('disconnect', onDisconnect);
        }
        byId.forEach(function (d) { if (d) d.oninputreport = null; });
        byId = [];
      }
    };
  }

  // ------------------------------------------------------------------ prueba fuera de partida
  /** Abre el dispositivo, enciende su LED y avisa de los botones pulsados: fn(lista) */
  function test(d, player, fn) {
    var stop = false;
    return open(d).then(function () {
      d.oninputreport = function (e) {
        if (stop) return;
        var bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength), b = buttonsOf(e.reportId, bytes);
        if (b) fn(b);
      };
      sendOut(d, 0x11, new Uint8Array([0x10 << (player % 4)]));  // LED del jugador, como en la consola
      sendOut(d, 0x12, new Uint8Array([0x00, 0x30]));             // informar de los botones
      return function () { stop = true; d.oninputreport = null; };
    });
  }

  CP.WiiLink = {
    supported: !!hid,
    known: known,
    add: add,
    forget: forget,
    attach: attach,
    test: test,
    label: label,
    kindOf: kindOf,
    _buttonsOf: buttonsOf,
    _sendOut: sendOut
  };
})(typeof window !== 'undefined' ? window : globalThis);
