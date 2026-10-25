"""Mando virtual vía /dev/uinput, sin dependencias (ioctl a pelo).

Se hace pasar por un mando Xbox 360 (045e:028e) para que SDL2 (PCSX2 y Dolphin)
lo reconozca y lo mapee solo con su base de datos de gamecontrollers.

Dentro del contenedor no hay udev: tras crear el dispositivo buscamos su nodo
event* en /sys y lo creamos con mknod en /dev/input (requiere CAP_MKNOD y la
regla de cgroup 'c 13:* rmw', que pone el agente).
"""
import fcntl
import os
import stat
import struct
import time

# ---- ioctl (linux/uinput.h) ----
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502
UI_DEV_SETUP = 0x405C5503  # _IOW('U', 3, struct uinput_setup[92])
UI_ABS_SETUP = 0x401C5504  # _IOW('U', 4, struct uinput_abs_setup[28])
UI_SET_EVBIT = 0x40045564
UI_SET_KEYBIT = 0x40045565
UI_SET_ABSBIT = 0x40045567
UI_GET_SYSNAME_64 = 0x8040552C  # _IOC(READ, 'U', 44, 64)

EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT = 0
BUS_USB = 0x03

BTN_A, BTN_B, BTN_X, BTN_Y = 0x130, 0x131, 0x133, 0x134
BTN_TL, BTN_TR = 0x136, 0x137
BTN_SELECT, BTN_START, BTN_MODE = 0x13A, 0x13B, 0x13C
BTN_THUMBL, BTN_THUMBR = 0x13D, 0x13E
ABS_X, ABS_Y, ABS_Z, ABS_RX, ABS_RY, ABS_RZ = 0, 1, 2, 3, 4, 5
ABS_HAT0X, ABS_HAT0Y = 0x10, 0x11

# Bits del protocolo de input (orden "standard gamepad" del W3C) -> código evdev.
# Ojo: el driver xpad de Linux manda el botón físico X (izquierda) como BTN_X
# y el Y (arriba) como BTN_Y; replicamos eso para que el mapeo de SDL cuadre.
BUTTON_MAP = {
    0: BTN_A,
    1: BTN_B,
    2: BTN_X,
    3: BTN_Y,
    4: BTN_TL,
    5: BTN_TR,
    8: BTN_SELECT,
    9: BTN_START,
    10: BTN_THUMBL,
    11: BTN_THUMBR,
}
BIT_LT, BIT_RT = 6, 7
BIT_UP, BIT_DOWN, BIT_LEFT, BIT_RIGHT = 12, 13, 14, 15

_EVENT = struct.Struct("llHHi")  # struct input_event (64 bits)


class VirtualPad:
    def __init__(self, index: int, owner_uid: int = 1000, owner_gid: int = 1000):
        self.index = index
        self.fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        self._state = {"buttons": 0, "lx": 0, "ly": 0, "rx": 0, "ry": 0, "lt": 0, "rt": 0}
        self._setup()
        self.node = self._make_node(owner_uid, owner_gid)

    # ------------------------------------------------------------------ setup
    def _setup(self) -> None:
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_ABS)
        for code in (*BUTTON_MAP.values(), BTN_MODE):
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, code)

        def absinfo(code, lo, hi, fuzz=0, flat=0):
            fcntl.ioctl(self.fd, UI_SET_ABSBIT, code)
            fcntl.ioctl(self.fd, UI_ABS_SETUP, struct.pack("HHiiiiii", code, 0, 0, lo, hi, fuzz, flat, 0))

        for code in (ABS_X, ABS_Y, ABS_RX, ABS_RY):
            absinfo(code, -32768, 32767, 16, 128)
        absinfo(ABS_Z, 0, 255)
        absinfo(ABS_RZ, 0, 255)
        absinfo(ABS_HAT0X, -1, 1)
        absinfo(ABS_HAT0Y, -1, 1)

        name = b"Microsoft X-Box 360 pad"
        setup = struct.pack("HHHH80sI", BUS_USB, 0x045E, 0x028E, 0x0110, name, 0)
        fcntl.ioctl(self.fd, UI_DEV_SETUP, setup)
        fcntl.ioctl(self.fd, UI_DEV_CREATE)

    def _make_node(self, uid: int, gid: int) -> str | None:
        buf = bytearray(64)
        fcntl.ioctl(self.fd, UI_GET_SYSNAME_64, buf)
        sysname = buf.split(b"\0", 1)[0].decode()
        base = f"/sys/devices/virtual/input/{sysname}"
        for _ in range(50):  # sysfs tarda unos ms en poblarse
            try:
                ev = next((e for e in os.listdir(base) if e.startswith("event")), None)
            except FileNotFoundError:
                ev = None
            if ev:
                major, minor = map(int, open(f"{base}/{ev}/dev").read().strip().split(":"))
                os.makedirs("/dev/input", exist_ok=True)
                path = f"/dev/input/{ev}"
                if not os.path.exists(path):
                    os.mknod(path, 0o660 | stat.S_IFCHR, os.makedev(major, minor))
                os.chown(path, uid, gid)
                return path
            time.sleep(0.02)
        return None

    # ----------------------------------------------------------------- events
    def _emit(self, events: list[tuple[int, int, int]]) -> None:
        if not events:
            return
        data = b"".join(_EVENT.pack(0, 0, t, c, v) for t, c, v in events)
        data += _EVENT.pack(0, 0, EV_SYN, SYN_REPORT, 0)
        try:
            os.write(self.fd, data)
        except BlockingIOError:
            pass

    def update(self, buttons: int, lx: int, ly: int, rx: int, ry: int, lt: int, rt: int) -> None:
        # Clientes sin gatillo analógico (táctil, mando de la tele) mandan el bit digital
        if buttons & (1 << BIT_LT) and lt == 0:
            lt = 255
        if buttons & (1 << BIT_RT) and rt == 0:
            rt = 255

        old = self._state
        ev: list[tuple[int, int, int]] = []
        changed = buttons ^ old["buttons"]
        for bit, code in BUTTON_MAP.items():
            if changed & (1 << bit):
                ev.append((EV_KEY, code, 1 if buttons & (1 << bit) else 0))

        def dpad(b):
            x = (1 if b & (1 << BIT_RIGHT) else 0) - (1 if b & (1 << BIT_LEFT) else 0)
            y = (1 if b & (1 << BIT_DOWN) else 0) - (1 if b & (1 << BIT_UP) else 0)
            return x, y

        nx, ny = dpad(buttons)
        ox, oy = dpad(old["buttons"])
        if nx != ox:
            ev.append((EV_ABS, ABS_HAT0X, nx))
        if ny != oy:
            ev.append((EV_ABS, ABS_HAT0Y, ny))

        for key, code, val in (
            ("lx", ABS_X, lx), ("ly", ABS_Y, ly), ("rx", ABS_RX, rx), ("ry", ABS_RY, ry),
            ("lt", ABS_Z, lt), ("rt", ABS_RZ, rt),
        ):
            if val != old[key]:
                ev.append((EV_ABS, code, val))

        self._state = {"buttons": buttons, "lx": lx, "ly": ly, "rx": rx, "ry": ry, "lt": lt, "rt": rt}
        self._emit(ev)

    def set_guide(self, pressed: bool) -> None:
        self._emit([(EV_KEY, BTN_MODE, 1 if pressed else 0)])

    def release_all(self) -> None:
        self.update(0, 0, 0, 0, 0, 0, 0)
        self.set_guide(False)

    def close(self) -> None:
        try:
            fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        finally:
            os.close(self.fd)
