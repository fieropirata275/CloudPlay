import asyncio, json
import os as _os
HERE = _os.path.dirname(_os.path.abspath(__file__))
from playwright.async_api import async_playwright
B="http://localhost:8077"
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = await br.new_page(viewport={"width":1280,"height":720})
        logs=[]
        pg.on("console", lambda m: logs.append(m.type+": "+m.text))
        pg.on("pageerror", lambda e: logs.append("PAGEERROR "+str(e)))
        await pg.goto(B+"/#/login"); await pg.wait_for_timeout(500)
        await pg.fill("#email","admin@local"); await pg.fill("#password","devpassword"); await pg.click("#login-form button[type=submit]")
        await pg.wait_for_timeout(1000)
        await pg.click(".tile >> nth=0")
        ok=False
        for i in range(40):
            await pg.wait_for_timeout(500)
            st = await pg.evaluate("({w: video.videoWidth, t: video.currentTime, status: document.querySelector('#player-status-text').textContent, hidden: document.querySelector('#player-status').hidden || document.querySelector('#player-status').classList.contains('ok')})")
            if st["w"] > 0 and st["t"] > 1: ok=True; break
        print("video:", st)
        # Mostrar stats y jugar: X=A, flecha derecha=D-pad, Enter=Start
        await pg.click("#menu-btn"); await pg.wait_for_timeout(300)
        await pg.click("[data-action=stats]"); await pg.wait_for_timeout(300)
        await pg.keyboard.down("x"); await pg.keyboard.down("ArrowRight"); await pg.wait_for_timeout(300)
        await pg.keyboard.up("x"); await pg.keyboard.up("ArrowRight"); await pg.wait_for_timeout(2600)
        await pg.screenshot(path=HERE + "/player.png")
        print("stats:", await pg.inner_text("#stats"))
        # Guardar estado desde el menú (canal de control)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        await pg.click("[data-action=savestate]"); await pg.wait_for_timeout(800)
        print("toast:", await pg.inner_text("#toast"))
        # Cerrar el juego
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        await pg.click("[data-action=quit]"); await pg.wait_for_timeout(1500)
        print("after quit hash:", await pg.evaluate("location.hash"))
        print("E2E_VIDEO_OK" if ok else "E2E_VIDEO_FAIL")
        print("\n".join(l for l in logs if "error" in l.lower())[:800])
        await br.close()
asyncio.run(main())
