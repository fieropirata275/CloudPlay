"""Proceso principal del contenedor de sesión.

Arranca como root SOLO para crear los mandos virtuales (uinput + mknod) y luego
baja a uid 1000 antes de abrir ninguna conexión de red ni lanzar el emulador.
"""
import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time

from .emulators import command, hotkey
from .protocol import InputDecoder
from .vpad import VirtualPad

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("cloudplay.session")

E = os.environ
SESSION_ID = E["SESSION_ID"]
WORKER_TOKEN = E["WORKER_TOKEN"]
SIGNAL_URL = E["SIGNAL_URL"]
PLATFORM = E["PLATFORM"]
ROM = E["ROM"]
DISPLAY = f":{E.get('DISPLAY_NUM', '100')}"
MAX_PADS = max(1, min(4, int(E.get("MAX_PADS", "1"))))
IDLE_TIMEOUT = int(E.get("IDLE_TIMEOUT", "180"))
ENCODER = E.get("ENCODER", "auto")
USE_VGL = E.get("USE_VGL", "auto")
VGL_DISPLAY = E.get("VGL_DISPLAY", "egl")
PLAYER_UID = PLAYER_GID = 1000


def drop_privileges() -> None:
    if os.getuid() != 0:
        return
    os.setgroups([])
    os.setgid(PLAYER_GID)
    os.setuid(PLAYER_UID)
    os.environ.update(HOME="/home/player", USER="player", LOGNAME="player")
    log.info("privilegios bajados a uid %d", os.getuid())


def ice_port_range():
    lo, hi = E.get("ICE_PORT_MIN"), E.get("ICE_PORT_MAX")
    return (int(lo), int(hi)) if lo and hi else None


class Session:
    def __init__(self, pads: list[VirtualPad]):
        self.pads = pads
        self.decoder = InputDecoder(len(pads))
        self.loop = asyncio.get_running_loop()
        self.outbox: asyncio.Queue[dict] = asyncio.Queue()
        self.client_present = False
        self.last_client_seen = time.monotonic()
        self.emu: subprocess.Popen | None = None
        self.stopping = asyncio.Event()
        self.exit_code = 0
        self._restart_handle: asyncio.TimerHandle | None = None

        from .streamer import Streamer  # importa GStreamer tras bajar privilegios

        self.streamer = Streamer(
            display=DISPLAY,
            send=self.send_threadsafe,
            on_input=self.on_input,
            on_control=self.on_control,
            ice_servers=json.loads(E.get("ICE_SERVERS", "[]")),
            encoder=ENCODER,
            fps=int(E.get("FPS", "60")),
            bitrate_kbps=int(E.get("BITRATE_KBPS", "8000")),
            max_bitrate_kbps=int(E.get("MAX_BITRATE_KBPS", "20000")),
            ice_port_range=ice_port_range(),
        )

    # ------------------------------------------------------------ emulator
    def launch_emulator(self) -> None:
        use_vgl = USE_VGL == "1" or (USE_VGL == "auto" and self.streamer.encoder_name != "x264")
        cmd = command(PLATFORM, ROM, use_vgl, VGL_DISPLAY)
        env = dict(os.environ, DISPLAY=DISPLAY, SDL_JOYSTICK_DISABLE_UDEV="1", QT_QPA_PLATFORM="xcb")
        log.info("lanzando: %s", " ".join(cmd))
        self.emu = subprocess.Popen(cmd, env=env, cwd=os.path.expanduser("~"))

    async def watch_emulator(self) -> None:
        while not self.stopping.is_set():
            code = self.emu.poll() if self.emu else None
            if code is not None:
                log.info("el emulador terminó con código %s", code)
                self.exit_code = 0 if code in (0, -signal.SIGTERM) else 1
                self.streamer.notify({"t": "bye", "reason": "emulator-exit"})
                self.stopping.set()
                return
            await asyncio.sleep(1)

    def xdotool_key(self, combo: str) -> bool:
        try:
            subprocess.Popen(["xdotool", "key", "--clearmodifiers", combo], env=dict(os.environ, DISPLAY=DISPLAY))
            return True
        except OSError as e:
            log.warning("no se pudo enviar el atajo %s: %s", combo, e)
            return False

    # --------------------------------------------------------------- input
    def on_input(self, data: bytes) -> None:  # hilo de GStreamer
        res = self.decoder.decode(data)
        if res is None:
            return
        idx, ev = res
        if ev[0] == "pad":
            self.pads[idx].update(*ev[1:])
        else:
            self.pads[idx].set_guide(ev[1])

    def on_control(self, msg: dict) -> None:  # hilo de GStreamer
        t = msg.get("t")
        if t in ("savestate", "loadstate", "nextslot", "screenshot"):
            key = hotkey(PLATFORM, t)
            if key and self.xdotool_key(key):
                self.streamer.notify({"t": "toast", "text": t})
        elif t == "quit":
            self.loop.call_soon_threadsafe(self.stopping.set)

    # ---------------------------------------------------------- signaling
    def send_threadsafe(self, msg: dict) -> None:
        self.loop.call_soon_threadsafe(self.outbox.put_nowait, msg)

    def schedule_stream_restart(self) -> None:
        # Agrupa varios "peer-joined" seguidos en un solo reinicio del pipeline
        if self._restart_handle:
            self._restart_handle.cancel()
        self._restart_handle = self.loop.call_later(0.3, self._restart_stream)

    def _restart_stream(self) -> None:
        for p in self.pads:
            p.release_all()
        self.decoder.reset()
        self.streamer.start()

    async def handle_signal(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "peer-joined" and msg.get("role") == "client":
            log.info("cliente conectado")
            self.client_present = True
            self.schedule_stream_restart()
        elif kind == "peer-left" and msg.get("role") == "client":
            log.info("cliente desconectado")
            self.client_present = False
            self.last_client_seen = time.monotonic()
            for p in self.pads:
                p.release_all()
            self.streamer.stop()
        elif kind == "answer":
            self.streamer.set_answer(msg.get("sdp", ""))
        elif kind == "ice":
            self.streamer.add_ice(msg.get("sdpMLineIndex", 0), msg.get("candidate", ""))
        elif kind == "session-state" and msg.get("status") in ("ended", "failed", "ending"):
            self.stopping.set()

    async def signaling(self) -> None:
        import websockets

        url = f"{SIGNAL_URL}?role=worker&token={WORKER_TOKEN}"
        backoff = 1
        while not self.stopping.is_set():
            try:
                async with websockets.connect(url, ping_interval=20, max_size=2**20) as ws:
                    backoff = 1
                    log.info("señalización conectada")

                    async def sender():
                        while True:
                            await ws.send(json.dumps(await self.outbox.get()))

                    async def receiver():
                        async for raw in ws:
                            try:
                                await self.handle_signal(json.loads(raw))
                            except ValueError:
                                pass

                    tasks = [asyncio.create_task(c) for c in (sender(), receiver(), self._wait_stop())]
                    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for t in tasks:
                        t.cancel()
            except Exception as e:  # noqa: BLE001
                if getattr(e, "code", None) == 4403 or "4403" in str(e):
                    log.error("señalización rechazada (sesión terminada o token inválido)")
                    self.stopping.set()
                    return
                log.warning("señalización caída: %s; reintento en %ss", e, backoff)
            if not self.stopping.is_set():
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15)

    async def _wait_stop(self) -> None:
        await self.stopping.wait()

    async def idle_watchdog(self) -> None:
        while not self.stopping.is_set():
            await asyncio.sleep(5)
            if not self.client_present and time.monotonic() - self.last_client_seen > IDLE_TIMEOUT:
                log.info("sin cliente durante %ss: cerrando sesión", IDLE_TIMEOUT)
                self.stopping.set()

    async def run(self) -> int:
        self.launch_emulator()
        for sig in (signal.SIGTERM, signal.SIGINT):
            self.loop.add_signal_handler(sig, self.stopping.set)
        tasks = [asyncio.create_task(c) for c in (self.signaling(), self.watch_emulator(), self.idle_watchdog())]

        def _crashed(t: asyncio.Task) -> None:
            if not t.cancelled() and t.exception() is not None:
                log.error("tarea %s murió: %r -> cerrando sesión", t.get_coro().__name__, t.exception())
                self.exit_code = 1
                self.stopping.set()

        for t in tasks:
            t.add_done_callback(_crashed)
        await self.stopping.wait()
        for t in tasks:
            t.cancel()
        self.streamer.shutdown()
        if self.emu and self.emu.poll() is None:
            self.emu.terminate()  # PCSX2/Dolphin vuelcan memcards al cerrar limpio
            try:
                self.emu.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.emu.kill()
        return self.exit_code


def main() -> int:
    pads = [VirtualPad(i, PLAYER_UID, PLAYER_GID) for i in range(MAX_PADS)]
    log.info("mandos virtuales: %s", [p.node for p in pads])
    drop_privileges()

    async def _run():
        return await Session(pads).run()

    try:
        return asyncio.run(_run())
    finally:
        for p in pads:
            p.close()


if __name__ == "__main__":
    sys.exit(main())
