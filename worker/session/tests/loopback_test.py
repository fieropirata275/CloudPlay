# Smoke test del streamer sin emulador: Xvfb :99 + webrtcbin "cliente" en loopback.
#   Xvfb :99 -screen 0 1280x720x24 & DISPLAY=:99 python3 tests/loopback_test.py
# Requiere gstreamer1.0-plugins-{base,good,bad,ugly}, gstreamer1.0-nice, gstreamer1.0-libav, gir1.2-gst-plugins-bad-1.0
import sys, time, json, threading, struct
sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), ".."))
from cloudplay import streamer as S
from cloudplay.protocol import PAD_STATE
from gi.repository import Gst, GstWebRTC, GstSdp

# Sin PulseAudio en el sandbox: audio de prueba en su lugar
orig = S.Streamer._describe
S.Streamer._describe = lambda self: orig(self).replace(
    f"pulsesrc device={self.pulse_source} do-timestamp=true buffer-time=20000 latency-time=10000", "audiotestsrc is-live=true")

got_input, got_ctrl, done = [], [], threading.Event()
cli = {}

def to_client(msg):
    if msg["type"] == "offer":
        sdp = msg["sdp"]
        cli["offer_sdp"] = sdp
        offer = S.parse_sdp(GstWebRTC.WebRTCSDPType.OFFER, sdp)
        def on_remote_set(p, _):
            def work():
                pr = Gst.Promise.new()
                cw.emit("create-answer", None, pr)
                pr.wait()
                on_answer(pr, None)
            threading.Thread(target=work).start()
        cw.emit("set-remote-description", offer, Gst.Promise.new_with_change_func(on_remote_set, None))
    elif msg["type"] == "ice":
        cw.emit("add-ice-candidate", msg["sdpMLineIndex"], msg["candidate"])

def on_answer(p, _):
    rep = p.get_reply()  # mantener referencia: encadenar get_reply().get_value() devuelve None en PyGObject
    ans = rep.get_value("answer")
    cw.emit("set-local-description", ans, Gst.Promise.new())
    st.set_answer(ans.sdp.as_text())

st = S.Streamer(":99", to_client, got_input.append, got_ctrl.append, [], encoder="auto", fps=30, bitrate_kbps=4000)

# "Cliente": webrtcbin que recibe y decodifica
cp = Gst.Pipeline.new("client"); _w = Gst.ElementFactory.make("webrtcbin", "c"); _w.set_property("bundle-policy", GstWebRTC.WebRTCBundlePolicy.MAX_BUNDLE); cp.add(_w)
cw = cp.get_by_name("c")
decoded = {"video": 0}
def on_pad(el, pad):
    if pad.direction != Gst.PadDirection.SRC: return
    caps = pad.get_current_caps().to_string()
    if "video" in caps:
        b = Gst.parse_bin_from_description("rtph264depay ! avdec_h264 ! fakesink name=vs signal-handoffs=true", True)
        cp.add(b); b.sync_state_with_parent(); pad.link(b.get_static_pad("sink"))
        b.get_by_name("vs").connect("handoff", lambda *a: decoded.__setitem__("video", decoded["video"]+1))
    else:
        b = Gst.parse_bin_from_description("fakesink", True); cp.add(b); b.sync_state_with_parent(); pad.link(b.get_static_pad("sink"))
cw.connect("pad-added", on_pad)
cw.connect("on-ice-candidate", lambda el, m, c: st.add_ice(m, c))
def on_dc(el, ch):
    lbl = ch.get_property("label")
    cli[lbl] = ch
    ch.connect("on-open", lambda c: cli.setdefault("open_" + lbl, True))
    if lbl == "control":
        ch.connect("on-message-string", lambda c, s: cli.setdefault("ctl", []).append(json.loads(s)))
cw.connect("on-data-channel", on_dc)
cp.set_state(Gst.State.PLAYING)

st.start()
t0 = time.time()
while time.time() - t0 < 15 and not (cli.get("input") and cli["input"].get_property("ready-state") == GstWebRTC.WebRTCDataChannelState.OPEN and decoded["video"] > 30):
    time.sleep(0.2)

sdp = cli.get("offer_sdp", "")
print("encoder:", st.encoder_name)
print("SDP H264/opus/datachannel:", "H264/90000" in sdp, "OPUS/48000" in sdp, "webrtc-datachannel" in sdp)
print("video frames decoded on client:", decoded["video"])
pkt = PAD_STATE.pack(1, 0, 0b1001, -32768, 32767, 0, 0, 255, 0, 7)
cli["input"].emit("send-data", __import__("gi").repository.GLib.Bytes.new(pkt))
cli["control"].emit("send-string", json.dumps({"t": "ping", "ts": 123}))
cli["control"].emit("send-string", json.dumps({"t": "savestate"}))
st.set_bitrate(6000); st.request_keyframe()
time.sleep(1.5)
print("input packets received by worker:", len(got_input), got_input[:1] == [pkt])
print("control -> app:", got_ctrl)
print("control <- worker:", [m.get("t") for m in cli.get("ctl", [])])
ok = decoded["video"] > 30 and got_input and got_ctrl == [{"t": "savestate"}] and "pong" in [m.get("t") for m in cli.get("ctl", [])]
st.shutdown(); cp.set_state(Gst.State.NULL)
print("LOOPBACK_OK" if ok else "LOOPBACK_FAIL")
