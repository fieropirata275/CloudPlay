"""Hace de Dolphin en el e2e del Wiimote: carga la libhidapi de CloudPlay (hidshim) igual que Dolphin, busca el
Wiimote, hace su apretón de manos (estado, lectura de memoria, modo de datos) y comprueba que llega el botón A
pulsado en el Wiimote "real" del navegador. Además muestra un patrón de vídeo para que haya imagen.
Escribe el resultado en wii_hid.json."""
import ctypes
import json
import os
import subprocess
import sys
import time
from ctypes import POINTER, c_char_p, c_int, c_size_t, c_ubyte, c_ushort, c_void_p, c_wchar_p

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "wii_hid.json")


class Info(ctypes.Structure):
    pass


Info._fields_ = [("path", c_char_p), ("vendor_id", c_ushort), ("product_id", c_ushort), ("serial", c_wchar_p),
                 ("release", c_ushort), ("manufacturer", c_wchar_p), ("product", c_wchar_p), ("usage_page", c_ushort),
                 ("usage", c_ushort), ("iface", c_int), ("next", POINTER(Info)), ("bus", c_int)]

lib = ctypes.CDLL(os.environ["HIDSHIM"])
lib.hid_enumerate.restype = POINTER(Info)
lib.hid_enumerate.argtypes = [c_ushort, c_ushort]
lib.hid_free_enumeration.argtypes = [POINTER(Info)]
lib.hid_open_path.restype = c_void_p
lib.hid_open_path.argtypes = [c_char_p]
lib.hid_write.argtypes = [c_void_p, POINTER(c_ubyte), c_size_t]
lib.hid_read_timeout.argtypes = [c_void_p, POINTER(c_ubyte), c_size_t, c_int]

video = subprocess.Popen(["gst-launch-1.0", "-q", "videotestsrc", "pattern=ball", "is-live=true", "!",
                          "video/x-raw,width=1280,height=720", "!", "ximagesink", "display=" + os.environ.get("DISPLAY", ":99")])
res = {"found": None, "status": False, "read": None, "buttons_a": False, "lost": False}


def save():
    with open(OUT, "w") as f:
        json.dump(res, f)


def write(h, data):
    buf = (c_ubyte * len(data))(*data)
    return lib.hid_write(h, buf, len(data))


def read(h, ms=500):
    buf = (c_ubyte * 64)()
    n = lib.hid_read_timeout(h, buf, 64, ms)
    return n, bytes(buf[:max(n, 0)])


save()
h = None
end = time.time() + 60
while time.time() < end and h is None:
    lst = lib.hid_enumerate(0, 0)
    if lst:
        res["found"] = lst.contents.product
        h = lib.hid_open_path(lst.contents.path)
        lib.hid_free_enumeration(lst)
    else:
        time.sleep(0.3)
if h is None:
    save(); sys.exit(0)
save()

write(h, [0x15, 0x00])                                  # estado
write(h, [0x17, 0x04, 0xA4, 0x00, 0xFA, 0x00, 0x06])    # leer el ID de la extensión
write(h, [0x12, 0x04, 0x30])                            # modo de datos: botones continuos
write(h, [0x11, 0x10])                                  # LED del jugador 1
end = time.time() + 30
while time.time() < end:
    n, r = read(h)
    if n < 0:
        res["lost"] = True; save(); break
    if not r:
        continue
    if r[0] == 0x20:
        res["status"] = True
    elif r[0] == 0x21:
        res["read"] = r.hex()
    elif r[0] == 0x30 and len(r) >= 3 and r[2] & 0x08:
        res["buttons_a"] = True
    save()
# sigue enseñando vídeo hasta que la sesión lo pare
video.wait()
