"""Captura del display virtual + audio de PulseAudio -> H.264/Opus -> WebRTC (webrtcbin).

Se reconstruye el pipeline entero cada vez que se conecta un cliente: el
emulador sigue corriendo, solo cambia la "cámara". Así un reconnect desde
otro dispositivo (del móvil a la tele) es limpio.
"""
import json
import logging
import threading
import urllib.parse
from typing import Callable

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")
from gi.repository import GLib, Gst, GstSdp, GstWebRTC  # noqa: E402

log = logging.getLogger("cloudplay.streamer")
Gst.init(None)

ENCODERS = {
    # nombre: (elemento, propiedades, perfil h264, nombre de la propiedad de bitrate)
    "nvidia": (
        "nvh264enc",
        {"preset": "low-latency-hq", "rc-mode": "cbr", "zerolatency": "true", "bframes": "0", "aud": "false"},
        "constrained-baseline",
        "bitrate",
    ),
    "vaapi": (
        "vah264enc",
        {"rate-control": "cbr", "b-frames": "0", "target-usage": "7", "ref-frames": "1"},
        "main",
        "bitrate",
    ),
    "x264": (
        "x264enc",
        {"tune": "zerolatency", "speed-preset": "ultrafast", "bframes": "0", "threads": "4", "sliced-threads": "true"},
        "constrained-baseline",
        "bitrate",
    ),
}
KEYINT_PROPS = ("gop-size", "key-int-max")


def pick_encoder(preferred: str) -> str:
    order = [preferred] if preferred in ENCODERS else []
    order += [e for e in ("nvidia", "vaapi", "x264") if e not in order]
    for name in order:
        if Gst.ElementFactory.find(ENCODERS[name][0]):
            return name
    raise RuntimeError("No hay ningún encoder H.264 disponible en GStreamer")


def set_props(el: Gst.Element, props: dict) -> None:
    """Pone propiedades solo si existen: los nombres cambian entre versiones de GStreamer."""
    for k, v in props.items():
        if el.find_property(k) is not None:
            Gst.util_set_object_arg(el, k, str(v))
        else:
            log.debug("%s no tiene la propiedad %s", el.get_name(), k)


def parse_sdp(kind, text: str):
    # No usar SDPMessage.new_from_text: con PyGObject el mensaje acaba liberado dos veces.
    _, msg = GstSdp.SDPMessage.new()
    if GstSdp.sdp_message_parse_buffer(text.encode(), msg) != GstSdp.SDPResult.OK:
        return None
    return GstWebRTC.WebRTCSessionDescription.new(kind, msg)


def _turn_uri(url: str, user: str, cred: str) -> str | None:
    # "turn:host:3478?transport=udp" -> "turn://user:pass@host:3478?transport=udp"
    scheme, _, rest = url.partition(":")
    if scheme not in ("turn", "turns"):
        return None
    q = urllib.parse.quote
    return f"{scheme}://{q(user, safe='')}:{q(cred, safe='')}@{rest}"


class Streamer:
    def __init__(
        self,
        display: str,
        send: Callable[[dict], None],
        on_input: Callable[[bytes], None],
        on_control: Callable[[dict], None],
        ice_servers: list[dict],
        encoder: str = "auto",
        fps: int = 60,
        bitrate_kbps: int = 8000,
        max_bitrate_kbps: int = 20000,
        ice_port_range: tuple[int, int] | None = None,
        pulse_source: str = "cloudplay.monitor",
    ):
        self.display, self.send, self.on_input, self.on_control = display, send, on_input, on_control
        self.ice_servers, self.fps, self.pulse_source = ice_servers, fps, pulse_source
        self.encoder_name = pick_encoder(encoder)
        self.bitrate = bitrate_kbps
        self.max_bitrate = max_bitrate_kbps
        self.ice_port_range = ice_port_range
        self.pipe: Gst.Pipeline | None = None
        self.webrtc = self.enc = self.control_ch = None
        self.lock = threading.RLock()
        self._loop = GLib.MainLoop()
        threading.Thread(target=self._loop.run, daemon=True, name="glib").start()
        log.info("encoder: %s (%s)", self.encoder_name, ENCODERS[self.encoder_name][0])

    # ---------------------------------------------------------------- build
    def _describe(self) -> str:
        el, _, profile, _ = ENCODERS[self.encoder_name]
        return (
            f"webrtcbin name=webrtc bundle-policy=max-bundle latency=0 "
            f"ximagesrc display-name={self.display} use-damage=false show-pointer=false "
            f"! video/x-raw,framerate={self.fps}/1 "
            f"! queue max-size-buffers=1 leaky=downstream "
            f"! videoconvert n-threads=4 ! video/x-raw,format=NV12 "
            f"! {el} name=enc "
            f"! video/x-h264,profile={profile},stream-format=byte-stream "
            f"! h264parse config-interval=-1 "
            f"! rtph264pay config-interval=-1 aggregate-mode=zero-latency mtu=1200 "
            f"! application/x-rtp,media=video,encoding-name=H264,payload=96,clock-rate=90000,"
            f"rtcp-fb-nack-pli=(boolean)true,rtcp-fb-nack=(boolean)true,rtcp-fb-ccm-fir=(boolean)true "
            f"! webrtc. "
            f"pulsesrc device={self.pulse_source} do-timestamp=true buffer-time=20000 latency-time=10000 "
            f"! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 "
            f"! queue max-size-time=60000000 leaky=downstream "
            f"! opusenc bitrate=128000 frame-size=10 audio-type=restricted-lowdelay "
            f"! rtpopuspay pt=111 "
            f"! application/x-rtp,media=audio,encoding-name=OPUS,payload=111,clock-rate=48000 "
            f"! webrtc. "
        )

    def start(self) -> None:
        """Arranca un pipeline nuevo y manda una offer. Llamar cuando entra un cliente."""
        with self.lock:
            self.stop()
            self._offered = False
            self.pipe = Gst.parse_launch(self._describe())
            self.webrtc = self.pipe.get_by_name("webrtc")
            self.enc = self.pipe.get_by_name("enc")
            _, props, _, br_prop = ENCODERS[self.encoder_name]
            set_props(self.enc, props)
            set_props(self.enc, {br_prop: self.bitrate})
            for p in KEYINT_PROPS:  # keyframe cada 2 s como red de seguridad; los PLI piden más
                set_props(self.enc, {p: self.fps * 2})

            self._configure_ice()
            self.webrtc.connect("on-ice-candidate", self._on_ice_candidate)
            self.webrtc.connect("notify::ice-connection-state", self._on_ice_state)

            bus = self.pipe.get_bus()
            bus.add_signal_watch()
            bus.connect("message::error", self._on_error)
            bus.connect("message::warning", lambda _b, m: log.warning("gst: %s", m.parse_warning()[0].message))

            self.pipe.set_state(Gst.State.PLAYING)

            for i in range(8):
                t = self.webrtc.emit("get-transceiver", i)
                if t is None:
                    break
                t.set_property("direction", GstWebRTC.WebRTCRTPTransceiverDirection.SENDONLY)
                # NACK/RTX SOLO en vídeo: Chrome rechaza la offer si el audio lleva un grupo
                # RTX (FID) porque sus streams de voz solo admiten un SSRC.
                kind = t.get_property("kind") if t.find_property("kind") is not None else None
                if kind in (None, GstWebRTC.WebRTCKind.UNKNOWN):
                    is_video = i == 0  # aún sin negociar: el vídeo va primero en el pipeline
                else:
                    is_video = kind == GstWebRTC.WebRTCKind.VIDEO
                if is_video and t.find_property("do-nack") is not None:
                    t.set_property("do-nack", True)

            # Canales de datos: input sin orden ni reintentos (estado completo en cada paquete),
            # control fiable y ordenado.
            opts = Gst.Structure.new_from_string(
                "application/data-channel,ordered=(boolean)false,max-retransmits=(int)0"
            )
            inp = self.webrtc.emit("create-data-channel", "input", opts)
            inp.connect("on-message-data", lambda _ch, data: self.on_input(bytes(data.get_data())))
            self.control_ch = self.webrtc.emit("create-data-channel", "control", None)
            self.control_ch.connect("on-message-string", self._on_control_string)
            self.control_ch.connect("on-open", lambda ch: self._send_control({"t": "hello", "encoder": self.encoder_name, "bitrate": self.bitrate}))
            self._input_ch = inp  # mantener referencia

            promise = Gst.Promise.new_with_change_func(self._on_offer_created, None)
            self.webrtc.emit("create-offer", None, promise)

    def _configure_ice(self) -> None:
        for srv in self.ice_servers:
            urls = srv.get("urls", [])
            urls = [urls] if isinstance(urls, str) else urls
            for u in urls:
                if u.startswith("stun:"):
                    self.webrtc.set_property("stun-server", "stun://" + u[5:])
                elif srv.get("username"):
                    uri = _turn_uri(u, srv["username"], srv.get("credential", ""))
                    if uri:
                        self.webrtc.emit("add-turn-server", uri)
        if self.ice_port_range:
            agent = self.webrtc.get_property("ice-agent")
            if agent is not None and agent.find_property("min-rtp-port") is not None:
                agent.set_property("min-rtp-port", self.ice_port_range[0])
                agent.set_property("max-rtp-port", self.ice_port_range[1])

    def stop(self) -> None:
        with self.lock:
            if self.pipe is not None:
                self.pipe.get_bus().remove_signal_watch()
                self.pipe.set_state(Gst.State.NULL)
            self.pipe = self.webrtc = self.enc = self.control_ch = None

    def shutdown(self) -> None:
        self.stop()
        self._loop.quit()

    # ------------------------------------------------------------ signaling
    def _on_offer_created(self, promise: Gst.Promise, _):
        reply = promise.get_reply()
        offer = reply.get_value("offer") if reply else None
        if offer is None or self.webrtc is None:
            log.error("no se pudo crear la offer")
            return
        self.webrtc.emit("set-local-description", offer, Gst.Promise.new())
        self._offered = True
        self.send({"type": "offer", "sdp": offer.sdp.as_text()})

    def set_answer(self, sdp: str) -> None:
        with self.lock:
            if self.webrtc is None:
                return
            answer = parse_sdp(GstWebRTC.WebRTCSDPType.ANSWER, sdp)
            if answer is None:
                log.warning("SDP de respuesta inválido")
                return
            self.webrtc.emit("set-remote-description", answer, Gst.Promise.new())

    def add_ice(self, mline: int, candidate: str) -> None:
        with self.lock:
            if self.webrtc is not None and candidate:
                self.webrtc.emit("add-ice-candidate", int(mline), candidate)

    def _on_ice_candidate(self, _el, mline: int, candidate: str) -> None:
        self.send({"type": "ice", "sdpMLineIndex": mline, "candidate": candidate})

    def _on_ice_state(self, el, _pspec) -> None:
        log.info("ICE: %s", el.get_property("ice-connection-state").value_nick)

    def _on_error(self, _bus, msg) -> None:
        err, dbg = msg.parse_error()
        log.error("gst error: %s (%s)", err.message, dbg)
        self.send({"type": "bye", "reason": f"stream error: {err.message}"})

    # -------------------------------------------------------------- control
    def _on_control_string(self, _ch, text: str) -> None:
        try:
            msg = json.loads(text)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        t = msg.get("t")
        if t == "ping":
            self._send_control({"t": "pong", "ts": msg.get("ts")})
        elif t == "bitrate":
            self.set_bitrate(int(msg.get("kbps", self.bitrate)))
        elif t == "keyframe":
            self.request_keyframe()
        else:
            self.on_control(msg)

    def _send_control(self, msg: dict) -> None:
        ch = self.control_ch
        if ch is not None:
            try:
                ch.emit("send-string", json.dumps(msg))
            except Exception:  # noqa: BLE001 - canal cerrado
                pass

    def notify(self, msg: dict) -> None:
        self._send_control(msg)

    def set_bitrate(self, kbps: int) -> None:
        kbps = max(1000, min(self.max_bitrate, kbps))
        self.bitrate = kbps
        with self.lock:
            if self.enc is not None:
                set_props(self.enc, {ENCODERS[self.encoder_name][3]: kbps})
        self._send_control({"t": "bitrate", "kbps": kbps})

    def request_keyframe(self) -> None:
        with self.lock:
            if self.enc is None:
                return
            s = Gst.Structure.new_from_string("GstForceKeyUnit,all-headers=(boolean)true")
            # Evento upstream entregado en el pad src del encoder (= como si lo pidiera el payloader)
            self.enc.get_static_pad("src").send_event(Gst.Event.new_custom(Gst.EventType.CUSTOM_UPSTREAM, s))
