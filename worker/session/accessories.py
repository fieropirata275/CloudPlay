#!/usr/bin/env python3
"""Accesorios de la partida: configura PCSX2 y Dolphin según lo que el jugador trae (SESSION_OPTIONS).

    accessories.py PCSX2.ini Dolphin.ini Config/  (lo llama setup-emu.sh)

Los botones salen de los mandos virtuales (SDL-0..3, "standard gamepad"); el micro es el micro virtual de
PulseAudio (lo que llega del ordenador del jugador); la cámara es /dev/video0 (v4l2loopback); el teclado y el
ratón son los del display virtual, donde session.py inyecta los del jugador (xinject.py).
"""
import json
import os
import re
import sys

PS2_USB = {
    # accesorio: (tipo de PCSX2, {binding: fuente})
    "singstar": ("singstar", {}),          # micro por defecto = el del jugador
    "headset": ("headset", {}),
    "eyetoy": ("webcam", {}),             # sin nombre: PCSX2 usa /dev/video0
    "buzz": ("BuzzDevice", {
        f"{color}{p}": f"SDL-{p - 1}/{src}"
        for p in range(1, 5)
        for color, src in (("Red", "FaceSouth"), ("Blue", "FaceNorth"), ("Orange", "FaceEast"),
                           ("Green", "FaceWest"), ("Yellow", "LeftShoulder"))
    }),
    # Batería USB (Rock Band / Guitar Hero World Tour): como las de Xbox, verde A, rojo B, azul X, amarillo Y, bombo LB
    "drums": ("RBDrumKit", {"Green": "SDL-0/FaceSouth", "Red": "SDL-0/FaceEast", "Blue": "SDL-0/FaceWest",
                            "Yellow": "SDL-0/FaceNorth", "Orange": "SDL-0/LeftShoulder",
                            "Start": "SDL-0/Start", "Select": "SDL-0/Back"}),
    # GunCon 2: apunta con el ratón del jugador (puntero absoluto en la pantalla), dispara con el clic
    "guncon2": ("guncon2", {"Trigger": "Pointer-0/LeftButton", "ShootOffscreen": "Pointer-0/RightButton",
                            "Recalibrate": "Pointer-0/MiddleButton", "A": "SDL-0/FaceSouth", "B": "SDL-0/FaceEast",
                            "C": "SDL-0/FaceWest", "Start": "SDL-0/Start", "Select": "SDL-0/Back",
                            "Up": "SDL-0/DPadUp", "Down": "SDL-0/DPadDown", "Left": "SDL-0/DPadLeft",
                            "Right": "SDL-0/DPadRight", "Pointer": "Pointer-0"}),
    "usb_keyboard": ("hidkbd", {}),
    "usb_mouse": ("hidmouse", {"Pointer": "Pointer-0", "LeftButton": "Pointer-0/LeftButton",
                               "RightButton": "Pointer-0/RightButton", "MiddleButton": "Pointer-0/MiddleButton"}),
}
# Guitarra de Guitar Hero (va en el puerto de mando, no en USB). Igual que la guitarra real de PS2 vista como
# DualShock: verde R2, rojo ◯, amarillo △, azul ✕, naranja □, púa = cruceta, palanca = stick derecho.
PS2_GUITAR = {"Type": "Guitar", "Up": "SDL-0/DPadUp", "Down": "SDL-0/DPadDown", "Select": "SDL-0/Back",
              "Start": "SDL-0/Start", "Green": "SDL-0/+RightTrigger", "Red": "SDL-0/FaceEast",
              "Yellow": "SDL-0/FaceNorth", "Blue": "SDL-0/FaceSouth", "Orange": "SDL-0/FaceWest",
              "Whammy": "SDL-0/+RightX", "Tilt": "SDL-0/+LeftTrigger"}

# GameCube (Dolphin.ini [Core]): SIDevice 6 mando, 7 teclado, 9 alfombra de baile, 10 bongos DK; SlotB 4 = micro
GC_SI = {"gc_bongos": ("SIDevice0", 10), "gc_dancemat": ("SIDevice0", 9), "gc_keyboard": ("SIDevice1", 7)}

# Teclado de GameCube -> teclas del display virtual (nombres de X11, como los ve Dolphin con XInput2)
GC_KEYS = {
    "HOME": "Home", "END": "End", "PGUP": "Prior", "PGDN": "Next", "SCR LK": "Scroll_Lock",
    **{c: c.lower() for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"}, **{d: d for d in "0123456789"},
    "-": "minus", "`": "grave", "PRT SC": "Print", "'": "apostrophe", "[": "bracketleft", "EQUALS": "equal",
    "*": "KP_Multiply", "]": "bracketright", ",": "comma", ".": "period", "/": "slash", "\\": "backslash",
    **{f"F{i}": f"F{i}" for i in range(1, 13)}, "ESC": "Escape", "INSERT": "Insert", "DELETE": "Delete",
    ";": "semicolon", "BACKSPACE": "BackSpace", "TAB": "Tab", "CAPS LOCK": "Caps_Lock", "L SHIFT": "Shift_L",
    "R SHIFT": "Shift_R", "L CTRL": "Control_L", "R ALT": "Alt_R", "L WIN": "Super_L", "SPACE": "space",
    "R WIN": "Super_R", "MENU": "Menu", "LEFT": "Left", "DOWN": "Down", "UP": "Up", "RIGHT": "Right", "ENTER": "Return",
}
X11_DEVICE = "XInput2/0/Virtual core pointer"


class Ini:
    """Edición mínima de INI que respeta el resto del fichero (configparser cambiaría mayúsculas y formato)."""

    def __init__(self, path: str):
        self.path = path
        self.lines = open(path).read().splitlines() if os.path.exists(path) else []

    def _section(self, name: str) -> tuple[int, int]:
        start = next((i for i, l in enumerate(self.lines) if l.strip() == f"[{name}]"), None)
        if start is None:
            if self.lines and self.lines[-1].strip():
                self.lines.append("")
            self.lines.append(f"[{name}]")
            return len(self.lines) - 1, len(self.lines)
        end = next((i for i in range(start + 1, len(self.lines)) if self.lines[i].startswith("[")), len(self.lines))
        return start, end

    def set(self, section: str, key: str, value) -> None:
        start, end = self._section(section)
        pat = re.compile(r"^\s*" + re.escape(key) + r"\s*=")
        for i in range(start + 1, end):
            if pat.match(self.lines[i]):
                self.lines[i] = f"{key} = {value}"
                return
        self.lines.insert(end, f"{key} = {value}")

    def clear(self, section: str) -> None:
        start, end = self._section(section)
        del self.lines[start + 1:end]

    def save(self) -> None:
        with open(self.path, "w") as f:
            f.write("\n".join(self.lines) + "\n")


def apply(options: dict, pcsx2_ini: str, dolphin_ini: str, dolphin_cfg: str) -> list[str]:
    acc = [a for a in (options.get("accessories") or []) if isinstance(a, str)]
    done = []
    # ---------------------------------------------------------------- PS2
    ps2 = Ini(pcsx2_ini)
    port = 1
    for a in acc:
        if a in PS2_USB and port <= 2:
            kind, binds = PS2_USB[a]
            sec = f"USB{port}"
            ps2.clear(sec)
            ps2.set(sec, "Type", kind)
            for k, v in binds.items():
                ps2.set(sec, f"{kind}_{k}", v)
            done.append(f"PS2 USB{port}: {kind}")
            port += 1
    if "guitar" in acc:
        ps2.clear("Pad1")
        for k, v in PS2_GUITAR.items():
            ps2.set("Pad1", k, v)
        done.append("PS2 puerto 1: guitarra")
    if {"guncon2", "usb_mouse"} & set(acc):
        ps2.set("InputSources", "Mouse", "true")  # fuente "Pointer": el ratón del display virtual
    ps2.save()
    # ------------------------------------------------------------ GameCube
    gc = Ini(dolphin_ini)
    for a in acc:
        if a in GC_SI:
            key, val = GC_SI[a]
            gc.set("Core", key, val)
            done.append(f"GameCube {key}={val}")
    if "gc_mic" in acc:
        gc.set("Core", "SlotB", 4)  # micrófono en la ranura B, como el de Mario Party 6/7
        done.append("GameCube micro en ranura B")
    gc.save()
    if "gc_keyboard" in acc:
        kb = Ini(os.path.join(dolphin_cfg, "GCKeyNew.ini"))
        kb.clear("GCKeyboard2")
        kb.set("GCKeyboard2", "Device", X11_DEVICE)
        for name, sym in GC_KEYS.items():
            kb.set("GCKeyboard2", f"Keys/{name}", f"`{sym}`")
        kb.save()
        done.append("GameCube teclado en el puerto 2")
    return done


if __name__ == "__main__":
    try:
        opts = json.loads(os.environ.get("SESSION_OPTIONS") or "{}")
    except ValueError:
        opts = {}
    if not isinstance(opts, dict):
        opts = {}
    for line in apply(opts, *sys.argv[1:4]):
        print("accesorio:", line)
