"""E2E de accesorios: partida de PS2 con teclado USB y GunCon 2. Lo que el jugador teclea y donde apunta/dispara
sobre el vídeo tiene que llegar al display virtual de la sesión (XTest). Lo lanza run.sh con E2E_ACC=1."""
import asyncio
import os
import subprocess
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
B = "http://localhost:8077"


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader"])
        pg = await br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(B + "/#/login"); await pg.wait_for_timeout(500)
        await pg.fill("#email", "admin@local"); await pg.fill("#password", "devpassword"); await pg.click("#login-form button[type=submit]")
        await pg.wait_for_timeout(1200)
        await pg.click(".filter[data-platform=ps2]"); await pg.wait_for_timeout(400)
        # Abrir la hoja de accesorios a mano (el juego de ejemplo no se llama "Time Crisis") y elegir teclado + GunCon
        gid = await pg.evaluate("document.querySelector('#grid .tile').getAttribute('data-id')")
        await pg.evaluate("localStorage.setItem('cp.acc.' + arguments[0], JSON.stringify(['usb_keyboard', 'guncon2']))".replace("arguments[0]", repr(gid)))
        await pg.click("#grid .tile >> nth=0")
        await pg.wait_for_timeout(600)
        sheet = await pg.evaluate("!document.querySelector('#acc-sheet').hidden && Array.prototype.map.call(document.querySelectorAll('#acc-list .acc.on b'), function (b) { return b.textContent; })")
        await pg.screenshot(path=HERE + "/acc_sheet.png")
        await pg.click("#acc-go")
        for _ in range(40):
            await pg.wait_for_timeout(500)
            if await pg.evaluate("!!(video.videoWidth && document.querySelector('#boot').hidden)"):
                break
        await pg.wait_for_timeout(800)
        aim = await pg.evaluate("document.querySelector('#screen-player').classList.contains('aim')")
        await pg.keyboard.press("KeyH"); await pg.keyboard.press("KeyI")
        box = await pg.evaluate("(function(){var r=video.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        # apunta al 75 % de ancho y 25 % de alto de la imagen y dispara
        await pg.mouse.move(box[0] + box[2] * 0.75, box[1] + box[3] * 0.25)
        await pg.mouse.down(); await pg.wait_for_timeout(150); await pg.mouse.up()
        await pg.wait_for_timeout(800)
        loc = subprocess.run(["xdotool", "getmouselocation"], capture_output=True, text=True, env={**os.environ, "DISPLAY": ":99"}).stdout.strip()
        log = open(os.path.join(HERE, "session.log")).read()
        print("hoja de accesorios:", sheet)
        print("cursor de pistola:", aim)
        print("teclado en la nube:", "teclado del jugador activo" in log, "· ratón en la nube:", "ratón del jugador activo" in log)
        print("puntero del display virtual:", loc, "(esperado ~x:959 y:179 en 1280x720)")
        print("errores:", errs or "ninguno")
        x = int(loc.split("x:")[1].split()[0]) if "x:" in loc else -1
        y = int(loc.split("y:")[1].split()[0]) if "y:" in loc else -1
        ok = sheet and aim and "teclado del jugador activo" in log and "ratón del jugador activo" in log and abs(x - 959) < 15 and abs(y - 179) < 15
        print("ACC_E2E_OK" if ok else "ACC_E2E_FAIL")
        await br.close()

asyncio.run(main())
