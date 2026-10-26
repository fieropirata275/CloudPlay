#!/usr/bin/env python3
"""Genera clients/web/js/padsdb.js a partir de SDL_GameControllerDB (licencia zlib).

    python3 tools/gen-padsdb.py [gamecontrollerdb.txt]

Convierte cada mapeo de SDL al orden de la Gamepad API de Chrome para mandos "no estándar":
 · Botones: SDL bN = botón HID N+1 = buttons[N] en Chrome. Igual.
 · Ejes en Windows y macOS: SDL los numera seguidos (solo los que existen) y Chrome los coloca por su uso HID
   (X=0, Y=1, Z=2, Rx=3, Ry=4, Rz=5). Con 4 ejes lo habitual es X,Y,Z,Rz → [0,1,2,5]; con 6, todos.
 · Cruceta como "hat": en Windows y macOS Chrome la da como un eje (uso 0x39 → axes[9]) con 8 posiciones;
   en Linux como los dos últimos ejes. El cliente decide en tiempo real (token hN = bit N del hat).
Lo que no cuadre se arregla con el asistente "Configurar mando" del cliente.
"""
import json
import sys
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/mdqinc/SDL_GameControllerDB/master/gamecontrollerdb.txt"
OUT = Path(__file__).resolve().parent.parent / "clients/web/js/padsdb.js"
PLATFORMS = {"Windows": 1, "Mac OS X": 2, "Linux": 3}
SLOT = {"a": 0, "b": 1, "x": 2, "y": 3, "leftshoulder": 4, "rightshoulder": 5, "lefttrigger": "lt",
        "righttrigger": "rt", "back": 8, "start": 9, "leftstick": 10, "rightstick": 11, "dpup": 12,
        "dpdown": 13, "dpleft": 14, "dpright": 15, "guide": 16, "leftx": "lx", "lefty": "ly",
        "rightx": "rx", "righty": "ry"}


def vidpid(guid: str):
    """GUID de SDL (USB/BT): bus(2) 0000 vendor(LE) 0000 product(LE) 0000 versión(LE) 0000."""
    if len(guid) != 32 or guid[:2] not in ("03", "05") or guid[4:8] != "0000" or guid[12:16] != "0000" or guid[20:24] != "0000":
        return None
    v = guid[10:12] + guid[8:10]
    p = guid[18:20] + guid[16:18]
    if v == "0000":
        return None
    return v + p


def axis_slots(n_axes: int):
    if n_axes == 4:
        return [0, 1, 2, 5]
    return list(range(max(n_axes, 0)))


def convert(mapping: dict, plat: int):
    axes = [int(v.strip("+-~")[1:]) for v in mapping.values() if v.strip("+-")[:1] == "a"]
    slots = axis_slots(max(axes) + 1) if axes and plat in (1, 2) else None
    out = []
    for name, val in mapping.items():
        slot = SLOT.get(name)
        if slot is None or not val:
            continue
        half = ""
        if val[0] in "+-":
            half, val = val[0], val[1:]
        inv = val.endswith("~")
        val = val.rstrip("~")
        if val[0] == "b":
            tok = val
        elif val[0] == "h":  # h0.4
            tok = "h" + val.split(".")[1]
        elif val[0] == "a":
            i = int(val[1:])
            if slots is not None:
                i = slots[i] if i < len(slots) else i
            tok = f"a{i}{half}{'~' if inv else ''}"
        else:
            continue
        out.append(f"{slot}:{tok}")
    # Entradas antiguas de SDL usan otra numeración (b56, a12...): no casan con el navegador, se descartan
    for t in out:
        tok = t.split(":", 1)[1]
        n = int("".join(ch for ch in tok[1:] if ch.isdigit()) or 0)
        if (tok[0] == "b" and n > 31) or (tok[0] == "a" and n > 15):
            return ""
    return ",".join(out)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    text = Path(src).read_text() if src else urllib.request.urlopen(URL, timeout=30).read().decode()
    db = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.rstrip(",").split(",")
        guid, name, fields = parts[0], parts[1], parts[2:]
        kv = dict(f.split(":", 1) for f in fields if ":" in f)
        plat = PLATFORMS.get(kv.pop("platform", ""))
        key = vidpid(guid)
        if not plat or not key:
            continue
        entry = db.setdefault(key, [name, "", "", ""])
        if not entry[plat]:
            entry[plat] = convert(kv, plat)
    body = json.dumps(db, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    OUT.write_text(
        "/* Perfiles de mandos generados con tools/gen-padsdb.py desde SDL_GameControllerDB\n"
        " * (https://github.com/mdqinc/SDL_GameControllerDB, licencia zlib). No editar a mano.\n"
        " * clave vvvvpppp (vendor/product hex) -> [nombre, Windows, macOS, Linux] */\n"
        f"window.CP=window.CP||{{}};CP.PADS_DB={body};\n"
    )
    print(f"{len(db)} mandos -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
