import asyncio, json, os, subprocess, sys, websockets
import os as _os
HERE = _os.path.dirname(_os.path.abspath(__file__))
TOKEN = sys.argv[1]
procs = {}
async def main():
    async with websockets.connect(f"ws://localhost:8077/ws/agent?token={TOKEN}") as ws:
        await ws.send(json.dumps({"type": "hello", "gpu": "cpu", "capacity": 2, "platforms": ["ps2", "gc", "wii"], "inventory": [], "sessions": []}))
        async def hb():
            while True:
                await asyncio.sleep(5); await ws.send(json.dumps({"type": "heartbeat", "sessions": list(procs)}))
        asyncio.create_task(hb())
        async for raw in ws:
            m = json.loads(raw)
            if m["type"] == "start":
                env = dict(os.environ, SESSION_ID=m["session_id"], WORKER_TOKEN=m["worker_token"], SIGNAL_URL=m["signal_url"],
                           PLATFORM=m["platform"], ROM="/library/" + m["rom_path"], DISPLAY_NUM="99", ENCODER="x264",
                           ICE_SERVERS="[]", USE_VGL="0", IDLE_TIMEOUT="60", BITRATE_KBPS="3000")
                procs[m["session_id"]] = subprocess.Popen([os.environ.get("GST_PYTHON", "python3"), HERE + "/run_session.py"], env=env,
                    stdout=open(HERE + "/session.log", "w"), stderr=subprocess.STDOUT)
                await ws.send(json.dumps({"type": "session_state", "session_id": m["session_id"], "status": "running"}))
            elif m["type"] == "stop":
                p = procs.pop(m["session_id"], None)
                if p: p.terminate()
                await ws.send(json.dumps({"type": "session_state", "session_id": m["session_id"], "status": "ended"}))
asyncio.run(main())
