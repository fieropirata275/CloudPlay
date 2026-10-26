// Wiimote "real" simulado como dispositivo WebHID (lo inyecta wii_hid.py antes de cargar la página).
(function () {
  var listeners = {};
  var dev = {
    vendorId: 0x057e, productId: 0x0306, productName: 'Nintendo RVL-CNT-01', opened: false, oninputreport: null,
    log: [], mode: 0x30, timer: null, pressA: false,
    open: function () { this.opened = true; return Promise.resolve(); },
    close: function () { this.opened = false; return Promise.resolve(); },
    forget: function () { return Promise.resolve(); },
    emit: function (rid, bytes) {
      if (!this.oninputreport) return;
      var u = new Uint8Array(bytes);
      this.oninputreport({ reportId: rid, data: new DataView(u.buffer) });
    },
    btn: function () { return [0x00, this.pressA ? 0x08 : 0x00]; },
    sendReport: function (rid, data) {
      var self = this, b = this.btn();
      this.log.push([rid, Array.prototype.slice.call(data)]);
      setTimeout(function () {
        if (rid === 0x15) self.emit(0x20, b.concat([0, 0, 0, 0xc8]));
        else if (rid === 0x17) self.emit(0x21, b.concat([0x57, 0x00, 0xfa, 0, 0, 0xa4, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        else if (rid === 0x16) self.emit(0x22, b.concat([0x16, 0]));
        else if (rid === 0x12) {
          self.mode = data[1];
          clearInterval(self.timer);
          self.timer = setInterval(function () { self.emit(self.mode, self.btn()); }, 10);
        }
      }, 2);
      return Promise.resolve();
    }
  };
  window.__fakeWiimote = dev;
  Object.defineProperty(navigator, 'hid', { configurable: true, value: {
    getDevices: function () { return Promise.resolve(window.__fakeWiimoteGone ? [] : [dev]); },
    requestDevice: function () { return Promise.resolve([dev]); },
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: function (t, fn) { listeners[t] = (listeners[t] || []).filter(function (f) { return f !== fn; }); },
    _fire: function (t) { (listeners[t] || []).forEach(function (fn) { fn({ device: dev }); }); }
  } });
})();
