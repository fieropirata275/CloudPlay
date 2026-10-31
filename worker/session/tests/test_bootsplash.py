"""Animación de arranque en un Xvfb de verdad: tapa al "emulador" mientras dura, lo enciende a su tiempo y al acabar
deja ver la consola. Los botones la saltan.  python3 worker/session/tests/test_bootsplash.py  (necesita Xvfb y gi)"""
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import gi  # noqa: E402

gi.require_version("Gst", "1.0")
from gi.repository import Gst  # noqa: E402

from cloudplay.bootsplash import BootSplash  # noqa: E402

DISPLAY = ":97"
WEBM = os.path.join(HERE, "..", "bootsplash", "ps2.webm")


def pixel() -> tuple[int, int, int]:
    """Un píxel del centro del display, capturado como lo captura el streamer (ximagesrc)"""
    p = Gst.parse_launch(f"ximagesrc display-name={DISPLAY} num-buffers=1 startx=600 starty=40 endx=601 endy=41 "
                         f"! videoconvert ! video/x-raw,format=RGB ! appsink name=s")
    p.set_state(Gst.State.PLAYING)
    sample = p.get_by_name("s").emit("try-pull-sample", 3 * Gst.SECOND)
    ok, info = sample.get_buffer().map(Gst.MapFlags.READ)
    r, g, b = info.data[0], info.data[1], info.data[2]
    p.set_state(Gst.State.NULL)
    return r, g, b


def red(px) -> bool:
    return px[0] > 200 and px[1] < 40 and px[2] < 40


def run(skip_after: float | None):
    events = {}
    emu = []

    def lead():
        events["lead"] = time.monotonic()
        emu.append(subprocess.Popen(["gst-launch-1.0", "-q", "videotestsrc", "pattern=red", "!",
                                     "video/x-raw,width=1280,height=720", "!", "ximagesink", f"display={DISPLAY}"]))

    s = BootSplash(DISPLAY, WEBM, lead=1.0, audio_sink="fakesink sync=true")
    assert s.available()
    t0 = time.monotonic()
    s.play(lead, lambda: events.__setitem__("done", time.monotonic()))
    seen = []
    while "done" not in events and time.monotonic() - t0 < 12:
        time.sleep(0.25)
        seen.append((round(time.monotonic() - t0, 2), red(pixel())))
        if skip_after is not None and "lead" in events and time.monotonic() - events["lead"] > skip_after - 1.0:
            s.skip()  # medio segundo después de empezar la animación
    time.sleep(0.6)
    after = red(pixel())
    for p in emu:
        p.terminate()
    return events, t0, seen, after


def test_bootsplash():
    if not shutil.which("Xvfb") or not os.path.exists(WEBM):
        print("sin Xvfb o sin bootsplash/ps2.webm: se omite")
        return
    x = subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", "1280x720x24", "-nolisten", "tcp"], stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        ev, t0, seen, after = run(None)
        print("entera:", {k: round(v - t0, 2) for k, v in ev.items()}, seen[:3], "...")
        # El reproductor tarda en arrancar según la máquina: los tiempos se miden desde que empieza la animación
        # (la consola se enciende 1 s después de empezar, lead=1.0)
        start = ev["lead"] - 1.0
        assert ev["lead"] - t0 > 0.9, "la consola no se enciende antes de tiempo"
        assert ev["done"] - start > 4.5, "la animación dura lo suyo"
        assert not any(r for t, r in seen if t > ev["lead"] - t0 + 0.4 and t < ev["done"] - t0 - 0.1), \
            "mientras dura, la ventana del emulador queda debajo"
        assert after, "al acabar se ve la consola"
        ev, t0, seen, after = run(1.5)
        print("saltada:", {k: round(v - t0, 2) for k, v in ev.items()})
        assert ev["done"] - (ev["lead"] - 1.0) < 3.0 and after, "un botón la salta y queda la consola"
    finally:
        x.terminate()
    print("BOOTSPLASH_OK")


if __name__ == "__main__":
    Gst.init(None)
    test_bootsplash()
