"""E2E del Wiimote real: navegador (Wiimote WebHID simulado) -> WebRTC -> session.py (puente HID) -> libhidapi de
CloudPlay -> "Dolphin" (fake_dolphin.py). Lo lanza run.sh con E2E_WII=1."""
import asyncio
import json
import os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
B = "http://localhost:8077"


def result():
    try:
        return json.load(open(os.path.join(HERE, "wii_hid.json")))
    except (OSError, ValueError):
        return {}


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await br.new_page(viewport={"width": 1280, "height": 720})
        logs = []
        pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
        await pg.add_init_script(path=os.path.join(HERE, "fake_hid.js"))
        await pg.goto(B + "/#/login"); await pg.wait_for_timeout(500)
        await pg.fill("#email", "admin@local"); await pg.fill("#password", "devpassword"); await pg.click("#login-form button[type=submit]")
        await pg.wait_for_timeout(1200)
        await pg.click(".filter[data-platform=wii]"); await pg.wait_for_timeout(500)
        await pg.click("#grid .tile >> nth=0")
        for _ in range(60):
            await pg.wait_for_timeout(500)
            r = result()
            if r.get("status") and r.get("read"):
                break
        await pg.evaluate("window.__fakeWiimote.pressA = true")
        for _ in range(20):
            await pg.wait_for_timeout(250)
            if result().get("buttons_a"):
                break
        fx = await pg.evaluate("Array.prototype.map.call(document.querySelectorAll('.pfx-wii'), function (e) { return e.textContent; })")
        await pg.screenshot(path=HERE + "/wii_hid.png")
        # El jugador apaga el Wiimote: el navegador avisa y "Dolphin" lo pierde
        await pg.evaluate("window.__fakeWiimoteGone = true; navigator.hid._fire('disconnect')")
        for _ in range(20):
            await pg.wait_for_timeout(250)
            if result().get("lost"):
                break
        r = result()
        out_reports = await pg.evaluate("window.__fakeWiimote.log.map(function (x) { return x[0]; })")
        print("resultado en la consola:", r)
        print("informes que llegaron al Wiimote:", sorted(set(out_reports)))
        print("animaciones:", fx)
        print("errores:", logs or "ninguno")
        ok = r.get("found") and r.get("status") and r.get("read", "").startswith("21") and r.get("buttons_a") and r.get("lost")
        print("WII_E2E_OK" if ok else "WII_E2E_FAIL")
        await br.close()

asyncio.run(main())
