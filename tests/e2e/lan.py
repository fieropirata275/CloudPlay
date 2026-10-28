"""E2E de LOCAL LAN MODE con dos jugadores reales en el navegador: cada uno con su partida de PS2 (session.py de
verdad), el primero crea un código, el segundo se une, y los dos ven LOCAL LAN MODE ON. Lo lanza run.sh con E2E_LAN=1."""
import asyncio
import os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
B = "http://localhost:8077"


async def player(br, nth):
    ctx = await br.new_context(viewport={"width": 1280, "height": 720},
                               record_video_dir=HERE + "/lanvid" if nth == 0 else None, record_video_size={"width": 1280, "height": 720})
    pg = await ctx.new_page()
    pg.errs = []
    pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    await pg.goto(B + "/#/login"); await pg.wait_for_timeout(500)
    await pg.fill("#email", "admin@local"); await pg.fill("#password", "devpassword"); await pg.click("#login-form button[type=submit]")
    await pg.wait_for_timeout(1200)
    await pg.click(".filter[data-platform=ps2]"); await pg.wait_for_timeout(400)
    await pg.click(f"#grid .tile >> nth={nth}")
    await pg.wait_for_timeout(500)
    if await pg.is_visible("#acc-go"):
        await pg.click("#acc-go")
    for _ in range(40):
        await pg.wait_for_timeout(500)
        if await pg.evaluate("!!(video.videoWidth && document.querySelector('#boot').hidden)"):
            break
    return ctx, pg


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader"])
        (c1, a), (c2, b) = await player(br, 0), await player(br, 1)
        # Jugador 1: menú -> Red local -> Crear un código
        await a.click("#menu-btn"); await a.wait_for_timeout(500)
        visible = await a.is_visible("[data-action=lan]")
        await a.click("[data-action=lan]"); await a.wait_for_timeout(500)
        await a.click("#lan-create"); await a.wait_for_timeout(1500)
        code = await a.text_content("#lan-code")
        await a.screenshot(path=HERE + "/lan_waiting.png")
        waiting = await a.text_content("#lan-status")
        await a.click("#lan-close"); await a.wait_for_timeout(400)
        # Jugador 2: se une con ese código
        await b.click("#menu-btn"); await b.wait_for_timeout(500)
        await b.click("[data-action=lan]"); await b.wait_for_timeout(500)
        # los dos registran la animación en cuanto aparece
        js = """window.__fx = []; new MutationObserver(function () {
            Array.prototype.forEach.call(document.querySelectorAll('.lanfx .lanfx-title'), function (e) {
              if (window.__fx.indexOf(e.textContent) < 0) window.__fx.push(e.textContent); });
          }).observe(document.body, { childList: true, subtree: true });"""
        await a.evaluate(js); await b.evaluate(js)
        await b.fill("#lan-input", code.lower())
        await b.click("#lan-go")
        await b.wait_for_timeout(1900)
        await a.screenshot(path=HERE + "/lan_on_a.png")
        await b.wait_for_timeout(600)
        fx_a = await a.evaluate("window.__fx")
        fx_b = await b.evaluate("window.__fx")
        status_b = await b.text_content("#lan-status")
        await b.screenshot(path=HERE + "/lan_on_b.png")
        await a.wait_for_timeout(3500)
        # El jugador 2 sale: el 1 vuelve a esperar
        await b.click("#lan-leave"); await b.wait_for_timeout(1500)
        await a.click("#menu-btn"); await a.wait_for_timeout(400)
        await a.click("[data-action=lan]"); await a.wait_for_timeout(500)
        after = await a.text_content("#lan-status")
        print("menú LAN visible en PS2:", visible, "· código:", code)
        print("jugador 1 esperando:", waiting)
        print("animación jugador 1:", fx_a, "· jugador 2:", fx_b, "·", status_b)
        print("tras salir el 2:", after)
        print("errores:", (a.errs + b.errs) or "ninguno")
        ok = visible and len(code) == 7 and "Esperando" in waiting and any("ON" in t for t in fx_a) and any("ON" in t for t in fx_b) \
            and "LOCAL LAN MODE ON" in status_b and "Esperando" in after and not (a.errs + b.errs)
        print("LAN_UI_E2E_OK" if ok else "LAN_UI_E2E_FAIL")
        await c1.close(); await c2.close(); await br.close()

asyncio.run(main())
