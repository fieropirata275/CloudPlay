/* Reproductor: señalización + RTCPeerConnection + canales de datos + bitrate adaptativo. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};

  var ABR = { min: 2000, max: 20000, start: 8000 };

  /**
   * opts: { session, video, onStatus(text, kind), onToast(text), onEnd(reason), onStats(obj), isTV }
   */
  function Player(opts) {
    this.o = opts;
    this.session = opts.session;
    this.video = opts.video;
    this.pc = null;
    this.ws = null;
    this.inputCh = null;
    this.controlCh = null;
    this.closed = false;
    this.pendingIce = [];
    this.bitrate = ABR.start;
    this.lastStats = null;
    this.rtt = 0;
    var self = this;
    this.needs = CP.Extras ? CP.Extras.needs(this.session && this.session.options) : {};
    this.input = new CP.InputManager({
      isTV: opts.isTV,
      rawKeys: !!this.needs.keyboard,
      sendControl: function (m) { self.control(m); },
      send: function (buf) {
        if (self.inputCh && self.inputCh.readyState === 'open') self.inputCh.send(buf);
      },
      onMenu: function () { if (opts.onMenu) opts.onMenu(); }
    });
    this.wii = null;
    this.hidCh = this.hidFastCh = null;
    // Mandos que se enchufan o se van durante la partida: animación de la consola (js/padfx.js)
    this._onPadConn = function (e) { self._padEvent(e.gamepad, true); };
    this._onPadDisc = function (e) { self._padEvent(e.gamepad, false); };
    root.addEventListener('gamepadconnected', this._onPadConn);
    root.addEventListener('gamepaddisconnected', this._onPadDisc);
  }

  /** Ratón del jugador sobre la imagen del juego (GunCon 2, ratón USB): estado completo por el canal de input */
  Player.prototype._startMouse = function () {
    if (this._mouseOn || !this.needs.mouse) return;
    this._mouseOn = true;
    var self = this, v = this.video, btns = 0, nx = 32768, ny = 32768, queued = false;
    if (this.needs.gun && v.parentNode && v.parentNode.classList) v.parentNode.classList.add('aim');
    function send() {
      queued = false;
      if (!self.inputCh || self.inputCh.readyState !== 'open') return;
      self.inputCh.send(new Uint8Array([4, btns, nx & 255, nx >> 8, ny & 255, ny >> 8]).buffer);
    }
    function pos(e) {
      // la imagen va con object-fit: contain: se descuentan las bandas negras
      var r = v.getBoundingClientRect(), vw = v.videoWidth || 16, vh = v.videoHeight || 9;
      var s = Math.min(r.width / vw, r.height / vh), w = vw * s, hh = vh * s;
      var x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - hh) / 2) / hh;
      nx = Math.round(Math.max(0, Math.min(1, x)) * 65535);
      ny = Math.round(Math.max(0, Math.min(1, y)) * 65535);
    }
    function bits(b) { return (b & 1) | (b & 2) | (b & 4); }  // izquierdo, derecho, central (como PointerEvent.buttons)
    this._mouseHandler = function (e) {
      pos(e);
      btns = bits(e.buttons);
      if (e.type === 'pointerdown' && v.setPointerCapture) { try { v.setPointerCapture(e.pointerId); } catch (x) {} }
      if (!queued) { queued = true; root.requestAnimationFrame(send); }
    };
    this._noMenu = function (e) { e.preventDefault(); };
    ['pointermove', 'pointerdown', 'pointerup'].forEach(function (t) { v.addEventListener(t, self._mouseHandler); });
    v.addEventListener('contextmenu', this._noMenu);
  };

  Player.prototype._stopMouse = function () {
    if (!this._mouseOn) return;
    var self = this, v = this.video;
    ['pointermove', 'pointerdown', 'pointerup'].forEach(function (t) { v.removeEventListener(t, self._mouseHandler); });
    v.removeEventListener('contextmenu', this._noMenu);
    if (v.parentNode && v.parentNode.classList) v.parentNode.classList.remove('aim');
    this._mouseOn = false;
  };

  Player.prototype.platform = function () {
    return this.session && this.session.game ? this.session.game.platform : '';
  };

  Player.prototype._padEvent = function (gp, connected) {
    if (this.closed || !gp || !this.o.onPadEvent) return;
    var d = CP.Pads ? CP.Pads.describe(gp) : { name: gp.id };
    this.o.onPadEvent({ kind: 'pad', player: gp.index + 1, connected: connected, name: d.name });
  };

  /** ¿La partida usa el micro o la cámara del jugador? (SingStar, micro de GameCube, EyeToy...) */
  Player.prototype._wantsMedia = function () {
    var o = (this.session && this.session.options) || {}, acc = o.accessories || [];
    return {
      mic: !!o.mic || acc.indexOf('singstar') >= 0 || acc.indexOf('headset') >= 0 || acc.indexOf('gc_mic') >= 0,
      cam: !!o.camera || acc.indexOf('eyetoy') >= 0
    };
  };

  Player.prototype._media = function () {
    var self = this, w = this._wantsMedia(), md = root.navigator.mediaDevices;
    if (this._mediaP) return this._mediaP;
    if ((!w.mic && !w.cam) || !md || !md.getUserMedia) return Promise.resolve(null);
    this._mediaP = md.getUserMedia({
      // el eco del juego por los altavoces se cancela; la voz se deja tal cual (SingStar la puntúa)
      audio: w.mic ? { echoCancellation: true, noiseSuppression: false, autoGainControl: true } : false,
      video: w.cam ? { width: 640, height: 480, frameRate: 30 } : false
    }).then(function (s) { self.localStream = s; return s; }, function () {
      self.o.onToast(w.cam ? 'Sin permiso para la cámara o el micro: la consola no los tendrá' : 'Sin permiso para el micro: la consola no te oirá');
      return null;
    });
    return this._mediaP;
  };

  /** La consola ofrece pistas de recepción (a=recvonly): se les engancha el micro y la cámara del jugador */
  Player.prototype._attachUpstream = function (offerSdp) {
    var want = {}, cur = null;
    String(offerSdp).split(/\r?\n/).forEach(function (l) {
      if (l.indexOf('m=') === 0) cur = { kind: l.slice(2).split(' ')[0], mid: null, recv: false };
      else if (cur && l.indexOf('a=mid:') === 0) cur.mid = l.slice(6).trim();
      else if (cur && l.trim() === 'a=recvonly') cur.recv = true;
      if (cur && cur.mid && cur.recv) want[cur.mid] = cur.kind;
    });
    if (!Object.keys(want).length) return Promise.resolve();
    var self = this;
    return this._media().then(function (stream) {
      self.pc.getTransceivers().forEach(function (t) {
        var kind = want[t.mid];
        if (!kind) return;
        var track = stream ? stream.getTracks().filter(function (x) { return x.kind === kind; })[0] : null;
        try { t.direction = 'sendonly'; } catch (e) {}
        if (track) t.sender.replaceTrack(track).catch(function () {});
      });
    });
  };

  Player.prototype.setMicMuted = function (muted) {
    if (!this.localStream) return false;
    this.localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
    return true;
  };

  /** Wiimotes / Balance Board reales del jugador: puente HID con la consola de la nube (js/wiilink.js) */
  Player.prototype._startWii = function () {
    var self = this;
    if (this.wii || !this.hidCh || !CP.WiiLink || !CP.WiiLink.supported || this.platform() !== 'wii') return;
    var send = function (ch) {
      return function (buf) { if (ch && ch.readyState === 'open') ch.send(buf); };
    };
    this.wii = CP.WiiLink.attach({
      sendReliable: send(this.hidCh),
      sendFast: function (buf) {
        var ch = self.hidFastCh && self.hidFastCh.readyState === 'open' ? self.hidFastCh : self.hidCh;
        send(ch)(buf);
      },
      onState: function (s) {
        if (self.o.onPadEvent) self.o.onPadEvent({ kind: s.kind, player: s.id + 1, connected: s.connected, name: s.name });
      }
    });
    this.hidCh.onmessage = function (e) { if (self.wii) self.wii.onMessage(e.data); };
  };

  Player.prototype._stage = function (name, data) {
    if (this.o.onStage) this.o.onStage(name, data || {});
  };

  Player.prototype.start = function () {
    var st = this.session.status;
    this._stage(st === 'queued' ? 'queue' : 'booting', { position: this.session.queue_position });
    this._connectSignal(0);
    var self = this;
    this._statsTimer = setInterval(function () { self._pollStats(); }, 2000);
    this._pingTimer = setInterval(function () { self.control({ t: 'ping', ts: Date.now() }); }, 3000);
  };

  Player.prototype._connectSignal = function (attempt) {
    if (this.closed) return;
    var self = this;
    var url = this.session.signal_url + '?role=client&token=' + encodeURIComponent(CP.token());
    this.o.onStatus(attempt ? 'Reconectando…' : 'Arrancando la consola en la nube…', 'loading');
    if (attempt) this._stage('reconnecting');
    var ws = this.ws = new WebSocket(url);
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      self._onSignal(m);
    };
    ws.onclose = function (ev) {
      if (self.closed) return;
      if (ev.code === 4403) { self.o.onEnd('La sesión ya no existe'); return; }
      if (ev.code === 4409) { self.o.onEnd('Has abierto esta partida en otro dispositivo'); return; }
      setTimeout(function () { self._connectSignal(attempt + 1); }, Math.min(1000 * Math.pow(2, attempt), 10000));
    };
  };

  Player.prototype._sendSignal = function (m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  };

  Player.prototype._onSignal = function (m) {
    var self = this;
    switch (m.type) {
      case 'peer-joined':
        if (m.role === 'worker') { this.o.onStatus('Conectando con el nodo…', 'loading'); this._stage('linking'); }
        break;
      case 'queue':
        this._stage('queue', { position: m.position });
        break;
      case 'offer':
        this._stage('linking');
        this._newPeer();
        this.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp })
          .then(function () {
            self.pendingIce.splice(0).forEach(function (c) { self.pc.addIceCandidate(c).catch(function () {}); });
            return self._attachUpstream(m.sdp);
          })
          .then(function () { return self.pc.createAnswer(); })
          .then(function (ans) { return self.pc.setLocalDescription(ans); })
          .then(function () { self._sendSignal({ type: 'answer', sdp: self.pc.localDescription.sdp }); })
          .catch(function (e) { self.o.onStatus('Error WebRTC: ' + e.message, 'error'); });
        break;
      case 'ice':
        if (!m.candidate) return;
        var c = { candidate: m.candidate, sdpMLineIndex: m.sdpMLineIndex };
        if (this.pc && this.pc.remoteDescription) this.pc.addIceCandidate(c).catch(function () {});
        else this.pendingIce.push(c);
        break;
      case 'peer-left':
        if (m.role === 'worker') this.o.onStatus('El nodo se ha desconectado, esperando…', 'loading');
        break;
      case 'session-state':
        if (m.status === 'starting') this._stage('booting');
        else if (m.status === 'failed') this.o.onEnd(m.error || 'La sesión ha fallado');
        else if (m.status === 'ended') this.o.onEnd('Sesión terminada');
        break;
      case 'bye':
        this.o.onEnd(m.reason === 'emulator-exit' ? 'El juego se ha cerrado' : (m.reason || 'Fin de la sesión'));
        break;
    }
  };

  Player.prototype._newPeer = function () {
    if (this.pc) { try { this.pc.close(); } catch (e) {} }
    var self = this;
    var pc = this.pc = new RTCPeerConnection({ iceServers: this.session.ice_servers || [], bundlePolicy: 'max-bundle' });
    var stream = new MediaStream();
    this.video.srcObject = stream;
    this.lastStats = null;

    pc.ontrack = function (ev) {
      stream.addTrack(ev.track);
      var r = ev.receiver;
      // Latencia mínima en el jitter buffer (Chrome/Chromium)
      try { if ('playoutDelayHint' in r) r.playoutDelayHint = 0; } catch (e) {}
      try { if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0; } catch (e) {}
      var p = self.video.play();
      if (p && p.catch) p.catch(function () {
        self.video.muted = true; // autoplay bloqueado con audio: arrancamos mudo y avisamos
        self.video.play();
        self.o.onToast('Toca la pantalla para activar el sonido');
      });
    };
    pc.onicecandidate = function (ev) {
      if (ev.candidate) self._sendSignal({ type: 'ice', candidate: ev.candidate.candidate, sdpMLineIndex: ev.candidate.sdpMLineIndex });
    };
    pc.onconnectionstatechange = function () {
      var s = pc.connectionState;
      if (s === 'connected') { self.o.onStatus('', 'ok'); self.input.start(); self._startMouse(); self._stage('live'); }
      else if (s === 'failed') { self.o.onStatus('No se pudo conectar (firewall/TURN)', 'error'); self._stage('error', { text: 'No se pudo conectar con el nodo. Revisa el firewall o el TURN.' }); }
      else if (s === 'disconnected') { self.o.onStatus('Conexión inestable…', 'loading'); self._stage('reconnecting'); }
    };
    pc.ondatachannel = function (ev) {
      var ch = ev.channel;
      ch.binaryType = 'arraybuffer';
      if (ch.label === 'input') self.inputCh = ch;
      if (ch.label === 'hidfast') self.hidFastCh = ch;
      if (ch.label === 'hid') {
        if (self.wii) { self.wii.stop(); self.wii = null; }  // cliente nuevo tras reconectar: se vuelve a vincular
        self.hidCh = ch;
        ch.onopen = function () { self._startWii(); };
      }
      if (ch.label === 'control') {
        self.controlCh = ch;
        ch.onmessage = function (e) { self._onControl(e.data); };
        ch.onopen = function () { self.control({ t: 'keyframe' }); self.control({ t: 'lan-status' }); };
      }
    };
  };

  Player.prototype._onControl = function (data) {
    var m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === 'pong') this.rtt = Date.now() - m.ts;
    else if (m.t === 'hello') { this.encoder = m.encoder; this.bitrate = m.bitrate; }
    else if (m.t === 'bitrate') this.bitrate = m.kbps;
    else if (m.t === 'toast') this.o.onToast({ savestate: 'Estado guardado', loadstate: 'Estado cargado', nextslot: 'Siguiente ranura', screenshot: 'Captura hecha' }[m.text] || m.text);
    else if (m.t === 'bye') this._onSignal({ type: 'bye', reason: m.reason });
    else if (m.t === 'lan' && this.o.onLan) this.o.onLan(m);
  };

  Player.prototype.control = function (m) {
    if (this.controlCh && this.controlCh.readyState === 'open') this.controlCh.send(JSON.stringify(m));
  };

  /** Bitrate adaptativo AIMD según pérdida de paquetes de vídeo. */
  Player.prototype._pollStats = function () {
    var self = this;
    if (!this.pc || this.pc.connectionState !== 'connected') return;
    this.pc.getStats().then(function (report) {
      var v = null, pair = null;
      report.forEach(function (s) {
        if (s.type === 'inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) v = s;
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
      });
      if (!v) return;
      var prev = self.lastStats, now = { lost: v.packetsLost || 0, recv: v.packetsReceived || 0, bytes: v.bytesReceived || 0,
        frames: v.framesDecoded || 0, ts: v.timestamp, jitter: v.jitter || 0 };
      self.lastStats = now;
      if (!prev) return;
      var dLost = now.lost - prev.lost, dRecv = now.recv - prev.recv, dt = (now.ts - prev.ts) / 1000;
      var loss = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;
      var kbps = Math.round((now.bytes - prev.bytes) * 8 / 1000 / dt);
      var fps = Math.round((now.frames - prev.frames) / dt);
      var target = self.bitrate;
      if (loss > 0.02) target = Math.max(ABR.min, Math.round(self.bitrate * 0.75));
      else if (loss < 0.005 && kbps > self.bitrate * 0.6) target = Math.min(ABR.max, self.bitrate + 500);
      if (self.manualBitrate) target = self.manualBitrate;
      if (Math.abs(target - self.bitrate) >= 250) self.control({ t: 'bitrate', kbps: target });
      if (self.o.onStats) self.o.onStats({
        fps: fps, kbps: kbps, loss: Math.round(loss * 1000) / 10, rtt: pair && pair.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : self.rtt,
        jitter: Math.round(now.jitter * 1000), target: self.bitrate, encoder: self.encoder || '?'
      });
    }).catch(function () {});
  };

  Player.prototype.setQuality = function (kbps) {
    this.manualBitrate = kbps || 0;
    if (kbps) this.control({ t: 'bitrate', kbps: kbps });
  };

  Player.prototype.pauseInput = function (paused) {
    if (paused) this.input.stop(); else this.input.start();
  };

  Player.prototype.close = function () {
    this.closed = true;
    if (this.wii) { this.wii.stop(); this.wii = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(function (t) { t.stop(); }); this.localStream = null; }
    this._stopMouse();
    root.removeEventListener('gamepadconnected', this._onPadConn);
    root.removeEventListener('gamepaddisconnected', this._onPadDisc);
    clearInterval(this._statsTimer);
    clearInterval(this._pingTimer);
    this.input.stop();
    if (this.pc) { try { this.pc.close(); } catch (e) {} }
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.video.srcObject = null;
  };

  CP.Player = Player;
})(window);
