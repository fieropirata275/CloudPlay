"""Arranque "de firmware" de CloudPlay: la animación de la consola sale por la señal de vídeo de la propia consola.

No es una capa del cliente: se pinta en el display virtual de la sesión (Xvfb), el mismo que captura el streamer,
así que en web, tele, Android y escritorio se ve igual, como si la consola trajera un firmware nuestro.

    primer cliente conectado -> ventana a pantalla completa por encima de todo (override-redirect) con
    bootsplash/<consola>.webm (vídeo + sonido a la salida de audio de la consola) -> a los LEAD segundos se
    enciende el emulador debajo -> la animación acaba en negro y queda la consola arrancando.

Cualquier botón del mando la salta. Sin fichero, sin X o con errores: se enciende la consola sin más.
"""
import ctypes
import ctypes.util
import logging
import os
import threading
import time
from typing import Callable

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstVideo", "1.0")
from gi.repository import Gst, GstVideo  # noqa: E402,F401  (GstVideo da set_window_handle a ximagesink)

log = logging.getLogger("cloudplay.bootsplash")
Gst.init(None)


class _XSetWindowAttributes(ctypes.Structure):
    _fields_ = [("background_pixmap", ctypes.c_ulong), ("background_pixel", ctypes.c_ulong),
                ("border_pixmap", ctypes.c_ulong), ("border_pixel", ctypes.c_ulong),
                ("bit_gravity", ctypes.c_int), ("win_gravity", ctypes.c_int), ("backing_store", ctypes.c_int),
                ("backing_planes", ctypes.c_ulong), ("backing_pixel", ctypes.c_ulong),
                ("save_under", ctypes.c_int), ("event_mask", ctypes.c_long),
                ("do_not_propagate_mask", ctypes.c_long), ("override_redirect", ctypes.c_int),
                ("colormap", ctypes.c_ulong), ("cursor", ctypes.c_ulong)]


CW_BACK_PIXEL = 1 << 1
CW_OVERRIDE_REDIRECT = 1 << 9


class _Window:
    """Ventana negra a pantalla completa que ningún gestor de ventanas mueve y que se mantiene arriba"""

    def __init__(self, display: str):
        x = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
        x.XOpenDisplay.restype = ctypes.c_void_p
        x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        x.XDefaultRootWindow.restype = ctypes.c_ulong
        x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        for f in ("XDisplayWidth", "XDisplayHeight", "XDefaultScreen"):
            getattr(x, f).argtypes = [ctypes.c_void_p] + ([ctypes.c_int] if f != "XDefaultScreen" else [])
        x.XCreateWindow.restype = ctypes.c_ulong
        x.XCreateWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint,
                                    ctypes.c_uint, ctypes.c_uint, ctypes.c_int, ctypes.c_uint, ctypes.c_void_p,
                                    ctypes.c_ulong, ctypes.POINTER(_XSetWindowAttributes)]
        for f in ("XMapRaised", "XRaiseWindow", "XDestroyWindow"):
            getattr(x, f).argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        for f in ("XFlush", "XCloseDisplay", "XSync"):
            getattr(x, f).argtypes = [ctypes.c_void_p] + ([ctypes.c_int] if f == "XSync" else [])
        self.x = x
        self.dpy = x.XOpenDisplay(display.encode())
        if not self.dpy:
            raise OSError(f"no se puede abrir el display {display}")
        scr = x.XDefaultScreen(self.dpy)
        self.w, self.h = x.XDisplayWidth(self.dpy, scr), x.XDisplayHeight(self.dpy, scr)
        attrs = _XSetWindowAttributes(background_pixel=0, override_redirect=1)
        self.xid = x.XCreateWindow(self.dpy, x.XDefaultRootWindow(self.dpy), 0, 0, self.w, self.h, 0, 0, 1, None,
                                   CW_BACK_PIXEL | CW_OVERRIDE_REDIRECT, ctypes.byref(attrs))
        x.XMapRaised(self.dpy, self.xid)
        x.XSync(self.dpy, 0)

    def raise_(self) -> None:
        self.x.XRaiseWindow(self.dpy, self.xid)
        self.x.XFlush(self.dpy)

    def close(self) -> None:
        self.x.XDestroyWindow(self.dpy, self.xid)
        self.x.XSync(self.dpy, 0)
        self.x.XCloseDisplay(self.dpy)


class BootSplash:
    def __init__(self, display: str, path: str, lead: float = 3.0,
                 audio_sink: str = "pulsesink sync=true"):
        self.display, self.path, self.lead, self.audio_sink = display, path, lead, audio_sink
        self._skip = threading.Event()
        self.running = False

    def available(self) -> bool:
        return os.path.isfile(self.path) and bool(Gst.ElementFactory.find("matroskademux"))

    def skip(self) -> None:
        if self.running and not self._skip.is_set():
            log.info("animación de arranque saltada")
            self._skip.set()

    def play(self, on_lead: Callable[[], None], on_done: Callable[[], None] | None = None) -> None:
        """Arranca en un hilo; on_lead enciende la consola (se llama siempre, una vez)"""
        self.running = True
        threading.Thread(target=self._run, args=(on_lead, on_done), daemon=True, name="bootsplash").start()

    def _run(self, on_lead, on_done) -> None:
        fired = threading.Event()

        def lead():
            if not fired.is_set():
                fired.set()
                try:
                    on_lead()
                except Exception:  # noqa: BLE001
                    log.exception("al encender la consola")

        win = pipe = None
        try:
            win = _Window(self.display)
            desc = (f'filesrc location="{self.path}" ! matroskademux name=d '
                    f"d.video_0 ! queue ! decodebin ! videoconvert ! videoscale add-borders=true "
                    f"! video/x-raw,width={win.w},height={win.h},pixel-aspect-ratio=1/1 "
                    f"! ximagesink name=sink display={self.display} sync=true force-aspect-ratio=true handle-events=false "
                    f"d.audio_0 ! queue ! decodebin ! audioconvert ! audioresample ! {self.audio_sink}")
            pipe = Gst.parse_launch(desc)
            pipe.get_by_name("sink").set_window_handle(win.xid)
            bus = pipe.get_bus()
            if pipe.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                raise RuntimeError("el reproductor no arranca")
            t0 = time.monotonic()
            log.info("animación de arranque: %s", os.path.basename(self.path))
            while True:
                win.raise_()  # el emulador abre su ventana encima: la nuestra vuelve arriba enseguida
                if not fired.is_set() and time.monotonic() - t0 >= self.lead:
                    threading.Thread(target=lead, daemon=True).start()
                if self._skip.is_set():
                    break
                msg = bus.timed_pop_filtered(15 * Gst.MSECOND, Gst.MessageType.EOS | Gst.MessageType.ERROR)
                if msg is None:
                    continue
                if msg.type == Gst.MessageType.ERROR:
                    err, _ = msg.parse_error()
                    raise RuntimeError(err.message)
                break  # EOS
        except Exception as e:  # noqa: BLE001 - la consola se enciende igual
            log.warning("sin animación de arranque: %s", e)
        finally:
            if pipe is not None:
                pipe.set_state(Gst.State.NULL)
            lead()
            if win is not None:
                try:
                    win.close()
                except Exception:  # noqa: BLE001
                    pass
            self.running = False
            if on_done:
                on_done()
