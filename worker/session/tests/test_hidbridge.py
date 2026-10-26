"""Puente HID sin Dolphin: un socket hace de Dolphin (lo que haría la libhidapi de CloudPlay) y una lista de
mensajes hace de navegador.  python -m pytest worker/session/tests/test_hidbridge.py"""
import os
import socket
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cloudplay.hidbridge import LINK, REPORT, STATE, UNLINK, HidBridge  # noqa: E402


def wait(cond, timeout=2.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


def console(path):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    s.connect(path)
    s.settimeout(2)
    return s


def test_link_relay_unlink(tmp_path):
    sent = []
    b = HidBridge(str(tmp_path), sent.append)
    b.on_message(bytes([LINK, 0, 0]))
    b.on_message(bytes([LINK, 1, 1]))
    assert sorted(os.listdir(tmp_path)) == ["board-2.sock", "wiimote-1.sock"]

    # Comprobación de Dolphin (prefijo 0xA2): no cuenta como conectado
    probe = console(str(tmp_path / "wiimote-1.sock"))
    probe.send(bytes([0xA2, 0x15, 0x00]))
    probe.close()
    time.sleep(0.1)
    assert sent == []

    dol = console(str(tmp_path / "wiimote-1.sock"))
    dol.send(bytes([0x15, 0x00]))  # Dolphin pide el estado
    assert wait(lambda: len(sent) >= 2)
    assert sent[0] == bytes([STATE, 0, 1])
    assert sent[1] == bytes([REPORT, 0, 0x15, 0x00])

    b.on_message(bytes([REPORT, 0, 0x20, 0, 0, 0, 0, 0, 0xC8]))  # el Wiimote real responde
    assert dol.recv(64) == bytes([0x20, 0, 0, 0, 0, 0, 0xC8])

    b.on_message(bytes([UNLINK, 0]))  # el jugador lo desconecta en su ordenador
    assert dol.recv(64) == b""  # Dolphin lee -1 y lo da por desconectado
    assert not (tmp_path / "wiimote-1.sock").exists()
    assert wait(lambda: bytes([STATE, 0, 0]) in sent)
    b.unlink_all()
    assert os.listdir(tmp_path) == []


def test_ignores_garbage(tmp_path):
    b = HidBridge(str(tmp_path), lambda m: None)
    for msg in (b"", b"\x01", bytes([LINK, 99, 0]), bytes([REPORT, 5, 1, 2]), bytes([9, 0])):
        b.on_message(msg)
    assert os.listdir(tmp_path) == []
