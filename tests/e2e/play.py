import asyncio
import os as _os
HERE = _os.path.dirname(_os.path.abspath(__file__))
from playwright.async_api import async_playwright
B = "http://localhost:8077"


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = await br.new_page(viewport={"width": 1280, "height": 720})
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
        pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
        await pg.goto(B + "/#/login"); await pg.wait_for_timeout(500)
        await pg.fill("#email", "admin@local"); await pg.fill("#password", "devpassword"); await pg.click("#login-form button[type=submit]")
        await pg.wait_for_timeout(1200)
        # Registrar las fases de la pantalla de arranque según pasan
        await pg.evaluate("""window.__stages = []; setInterval(function () {
            var li = document.querySelector('#boot-steps li.now');
            var t = document.querySelector('#boot').hidden ? 'hidden' : (li && li.getAttribute('data-step'));
            if (t && window.__stages[window.__stages.length - 1] !== t) window.__stages.push(t);
        }, 30);""")
        await pg.click("#grid .tile >> nth=0")
        await pg.wait_for_timeout(450)
        await pg.screenshot(path=HERE + "/boot.png")
        ok = False
        for _ in range(40):
            await pg.wait_for_timeout(500)
            st = await pg.evaluate("({w: video.videoWidth, t: video.currentTime, boot: document.querySelector('#boot').hidden})")
            if st["w"] > 0 and st["t"] > 1 and st["boot"]:
                ok = True
                break
        print("video:", st)
        print("fases de arranque:", await pg.evaluate("window.__stages"))
        # Estadísticas y jugar: X=A, flecha derecha=D-pad
        await pg.click("#menu-btn"); await pg.wait_for_timeout(500)
        await pg.click("[data-action=stats]"); await pg.wait_for_timeout(400)
        await pg.keyboard.down("x"); await pg.keyboard.down("ArrowRight"); await pg.wait_for_timeout(300)
        await pg.keyboard.up("x"); await pg.keyboard.up("ArrowRight"); await pg.wait_for_timeout(2600)
        await pg.screenshot(path=HERE + "/player.png")
        print("stats:", await pg.inner_text("#stats"))
        # Guardar estado desde el menú (canal de control)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=HERE + "/menu.png")
        await pg.click("[data-action=savestate]"); await pg.wait_for_timeout(900)
        print("toast:", await pg.inner_text("#toast"))
        # Cerrar el juego
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(500)
        await pg.click("[data-action=quit]"); await pg.wait_for_timeout(1800)
        print("after quit hash:", await pg.evaluate("location.hash"))
        # La partida cuenta como reciente
        recent = await pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#rail-recent .tile'), function (t) { return t.getAttribute('data-id'); }).length")
        print("recientes:", recent)
        print("E2E_VIDEO_OK" if ok else "E2E_VIDEO_FAIL")
        print("\n".join(l for l in logs if "error" in l.lower())[:800])
        await br.close()

asyncio.run(main())
