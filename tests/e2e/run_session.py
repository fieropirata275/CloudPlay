"""Ejecuta cloudplay.session real con: mando falso (sin /dev/uinput), patrón de vídeo en vez de emulador y audiotestsrc."""
import json, os, sys
import os as _os
HERE = _os.path.dirname(_os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "worker", "session"))
import cloudplay.session as sess
import cloudplay.streamer as S

class FakePad:
    def __init__(self, i, *a): self.i, self.node = i, f"fake{i}"
    def update(self, *st):
        with open(HERE + "/pad.log", "a") as f: f.write(json.dumps([self.i, *st]) + "\n")
    def set_guide(self, p): pass
    def release_all(self): pass
    def close(self): pass

sess.VirtualPad = FakePad
sess.drop_privileges = lambda: None  # sandbox: no hay usuario player
sess.command = lambda *a: ["gst-launch-1.0", "-q", "videotestsrc", "pattern=ball", "is-live=true", "!", "video/x-raw,width=1280,height=720", "!", "ximagesink", "display=:99"]
orig = S.Streamer._describe
S.Streamer._describe = lambda self: orig(self).replace(
    f"pulsesrc device={self.pulse_source} do-timestamp=true buffer-time=20000 latency-time=10000", "audiotestsrc is-live=true wave=silence")
sys.exit(sess.main())
