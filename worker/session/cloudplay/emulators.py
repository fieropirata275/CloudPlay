"""Cómo lanzar cada emulador y qué teclas usa para sus atajos (enviadas con xdotool)."""
import os

PCSX2_BIN = os.environ.get("PCSX2_BIN", "/opt/pcsx2/AppRun")
DOLPHIN_BIN = os.environ.get("DOLPHIN_BIN", "dolphin-emu-nogui")
DOLPHIN_USER = "/home/player/.dolphin"

PROFILES = {
    "ps2": {
        "cmd": lambda rom: [PCSX2_BIN, "-nogui", "-fullscreen", "-batch", "--", rom],
        # Hotkeys por defecto de PCSX2
        "hotkeys": {"savestate": "F1", "loadstate": "F3", "nextslot": "F2", "screenshot": "F8", "turbo": "Tab"},
    },
    "gc": {
        "cmd": lambda rom: [DOLPHIN_BIN, "-u", DOLPHIN_USER, "-p", "x11", "-e", rom],
        "hotkeys": {"savestate": "shift+F1", "loadstate": "F1", "screenshot": "F9", "turbo": "Tab"},
    },
}
PROFILES["wii"] = PROFILES["gc"]


def command(platform: str, rom: str, use_vgl: bool, vgl_display: str) -> list[str]:
    cmd = PROFILES[platform]["cmd"](rom)
    if use_vgl:
        # VirtualGL con backend EGL: render OpenGL en la GPU del host, presentado en Xvfb
        cmd = ["vglrun", "-d", vgl_display, *cmd]
    return cmd


def hotkey(platform: str, action: str) -> str | None:
    return PROFILES.get(platform, {}).get("hotkeys", {}).get(action)
