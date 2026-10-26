"""E2E de subida: el micro y la cámara del navegador (simulados por Chromium) llegan a la sesión de la nube.
Lo lanza run.sh con E2E_MEDIA=1; la sesión escribe en session.log las tramas recibidas."""
import asyncio
import os
import re
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
B = "http://localhost:8077"


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream",
                                           "--use-fake-ui-for-media-stream", "--use-gl=angle", "--use-angle=swiftshader"])
        ctx = await br.new_context(viewport={"width": 1280, "height": 720}, permissions=["microphone", "camera"])
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(B + "/#/login"); await pg.wait_for_timeout(500)
        await pg.fill("#email", "admin@local"); await pg.fill("#password", "devpassword"); await pg.click("#login-form button[type=submit]")
        await pg.wait_for_timeout(1200)
        # El jugador ha elegido SingStar + EyeToy para este juego
        await pg.evaluate("CP.Extras.optionsFor = function () { return Promise.resolve({ mic: true, camera: true, accessories: ['singstar', 'eyetoy'] }); }")
        await pg.click(".filter[data-platform=ps2]"); await pg.wait_for_timeout(400)
        await pg.click("#grid .tile >> nth=0")
        for _ in range(40):
            await pg.wait_for_timeout(500)
            if await pg.evaluate("!!(video.videoWidth && document.querySelector('#boot').hidden)"):
                break
        await pg.wait_for_timeout(7000)
        sent = await pg.evaluate("""(async function () {
            var st = await state_player_stats();
            return st;
        })""".replace("state_player_stats()", "Promise.resolve(0)"))
        log = open(os.path.join(HERE, "session.log")).read()
        a = [int(x) for x in re.findall(r"subida de audio: (\d+)", log)]
        v = [int(x) for x in re.findall(r"subida de video: (\d+)", log)]
        print("micro recibido:", "recibiendo micro" in log, "· tramas de audio:", max(a or [0]))
        print("cámara recibida:", "recibiendo cámara" in log, "· tramas de vídeo:", max(v or [0]))
        print("errores:", errs or "ninguno")
        print("MEDIA_E2E_OK" if max(a or [0]) >= 100 and max(v or [0]) >= 100 else "MEDIA_E2E_FAIL")
        await br.close()

asyncio.run(main())
