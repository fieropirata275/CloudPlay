"""Teclado y ratón del jugador dentro del display virtual (XTest), para los accesorios que los usan: teclado y
ratón USB de PS2, pistola GunCon 2 (apunta con el ratón) y teclado de GameCube.

Las teclas llegan con el KeyboardEvent.code del navegador ("KeyA", "Enter"...) por el canal fiable y el ratón
como estado completo (botones + posición 0..65535) por el canal de input.
"""
import ctypes
import ctypes.util
import logging
import threading

log = logging.getLogger("cloudplay.xinject")

# KeyboardEvent.code -> keysym de X11
_SPECIAL = {
    "Enter": "Return", "NumpadEnter": "KP_Enter", "Escape": "Escape", "Backspace": "BackSpace", "Tab": "Tab",
    "Space": "space", "Minus": "minus", "Equal": "equal", "BracketLeft": "bracketleft", "BracketRight": "bracketright",
    "Backslash": "backslash", "Semicolon": "semicolon", "Quote": "apostrophe", "Backquote": "grave", "Comma": "comma",
    "Period": "period", "Slash": "slash", "CapsLock": "Caps_Lock", "ShiftLeft": "Shift_L", "ShiftRight": "Shift_R",
    "ControlLeft": "Control_L", "ControlRight": "Control_R", "AltLeft": "Alt_L", "AltRight": "Alt_R",
    "MetaLeft": "Super_L", "MetaRight": "Super_R", "ContextMenu": "Menu", "Insert": "Insert", "Delete": "Delete",
    "Home": "Home", "End": "End", "PageUp": "Prior", "PageDown": "Next", "ArrowUp": "Up", "ArrowDown": "Down",
    "ArrowLeft": "Left", "ArrowRight": "Right", "PrintScreen": "Print", "ScrollLock": "Scroll_Lock", "Pause": "Pause",
    "NumpadMultiply": "KP_Multiply", "NumpadAdd": "KP_Add", "NumpadSubtract": "KP_Subtract",
    "NumpadDecimal": "KP_Decimal", "NumpadDivide": "KP_Divide", "IntlBackslash": "less",
}


def keysym_name(code: str) -> str | None:
    if not isinstance(code, str) or len(code) > 24:
        return None
    if code.startswith("Key") and len(code) == 4 and code[3].isalpha():
        return code[3].lower()
    if code.startswith("Digit") and len(code) == 6 and code[5].isdigit():
        return code[5]
    if code.startswith("Numpad") and len(code) == 7 and code[6].isdigit():
        return "KP_" + code[6]
    if code.startswith("F") and code[1:].isdigit() and 1 <= int(code[1:]) <= 24:
        return code
    return _SPECIAL.get(code)


class XInject:
    def __init__(self, display: str, width: int, height: int):
        self.w, self.h = width, height
        self.lock = threading.Lock()
        self.buttons = 0
        self.down: set[int] = set()
        x11 = ctypes.util.find_library("X11")
        xtst = ctypes.util.find_library("Xtst")
        if not x11 or not xtst:
            raise OSError("faltan libX11 / libXtst")
        self.x = ctypes.CDLL(x11)
        self.t = ctypes.CDLL(xtst)
        self.x.XOpenDisplay.restype = ctypes.c_void_p
        self.x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x.XStringToKeysym.restype = ctypes.c_ulong
        self.x.XStringToKeysym.argtypes = [ctypes.c_char_p]
        self.x.XKeysymToKeycode.restype = ctypes.c_ubyte
        self.x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x.XFlush.argtypes = [ctypes.c_void_p]
        self.t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.t.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.t.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        self.dpy = self.x.XOpenDisplay(display.encode())
        if not self.dpy:
            raise OSError(f"no se pudo abrir el display {display}")

    def key(self, code: str, down: bool) -> bool:
        name = keysym_name(code)
        if not name:
            return False
        with self.lock:
            kc = self.x.XKeysymToKeycode(self.dpy, self.x.XStringToKeysym(name.encode()))
            if not kc:
                return False
            if down:
                self.down.add(kc)
            else:
                self.down.discard(kc)
            self.t.XTestFakeKeyEvent(self.dpy, kc, 1 if down else 0, 0)
            self.x.XFlush(self.dpy)
        return True

    def mouse(self, buttons: int, nx: int, ny: int) -> None:
        """buttons: bit0 izquierdo, bit1 derecho, bit2 central · nx, ny: 0..65535 sobre la imagen del juego"""
        x, y = nx * (self.w - 1) // 65535, ny * (self.h - 1) // 65535
        with self.lock:
            self.t.XTestFakeMotionEvent(self.dpy, -1, x, y, 0)
            for bit, xbtn in ((1, 1), (2, 3), (4, 2)):
                if (buttons ^ self.buttons) & bit:
                    self.t.XTestFakeButtonEvent(self.dpy, xbtn, 1 if buttons & bit else 0, 0)
            self.buttons = buttons
            self.x.XFlush(self.dpy)

    def release_all(self) -> None:
        with self.lock:
            for kc in list(self.down):
                self.t.XTestFakeKeyEvent(self.dpy, kc, 0, 0)
            self.down.clear()
            for bit, xbtn in ((1, 1), (2, 3), (4, 2)):
                if self.buttons & bit:
                    self.t.XTestFakeButtonEvent(self.dpy, xbtn, 0, 0)
            self.buttons = 0
            self.x.XFlush(self.dpy)
