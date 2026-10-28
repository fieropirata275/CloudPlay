"""Animación de arranque "de firmware" por la señal de vídeo: el cliente web REAL recibe primero la animación de la
consola (pintada en el display de la sesión) y después la consola (aquí, el patrón de la pelota de videotestsrc).
También comprueba que un botón del mando la salta. Imprime BOOT_E2E_OK."""
import asyncio
import os
import time

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
B = "http://localhost:8077"

SAMPLE = """() => {
  var v = document.querySelector('video'); if (!v || !v.videoWidth) return null;
  var c = window.__c || (window.__c = document.createElement('canvas')); c.width = 128; c.height = 72;
  var g = c.getContext('2d'); g.drawImage(v, 0, 0, 128, 72);
  var d = g.getImageData(0, 0, 128, 72).data, r = 0, gg = 0, b = 0, white = 0;
  for (var i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i+1]; b += d[i+2]; if (d[i] > 200 && d[i+1] > 200 && d[i+2] > 200) white++; }
  var n = d.length / 4; return { r: r / n, g: gg / n, b: b / n, white: white / n };
}"""


def kind(s):
    if s is None:
        return "-"
    if s["b"] - s["r"] > 3:
        return "animacion"        # fondo y metal tintados de la consola
    if s["white"] > 0 and s["r"] + s["g"] + s["b"] < 30:
        return "consola"          # la pelota blanca sobre negro del "emulador" de prueba
    if s["r"] + s["g"] + s["b"] > 30:
        return "animacion"
    return "negro"


async def play(br, skip_at=None, shots=False):
    pg = await br.new_page(viewport={"width": 1280, "height": 720})
    await pg.goto(B + "/#/login"); await pg.wait_for_timeout(500)
    if await pg.is_visible("#email"):
        await pg.fill("#email", "admin@local"); await pg.fill("#password", "devpassword")
        await pg.click("#login-form button[type=submit]")
    await pg.wait_for_timeout(1200)
    await pg.click("#grid .tile >> nth=0")
    seq, t0, shot_at, skipped = [], None, [0.6, 1.6, 2.4, 3.6, 4.3, 7.0], False
    end = time.monotonic() + 30
    while time.monotonic() < end:
        s = await pg.evaluate(SAMPLE)
        k = kind(s)
        if t0 is None and k != "-":
            t0 = time.monotonic()
        if t0 is not None:
            el = time.monotonic() - t0
            if not seq or seq[-1][1] != k:
                seq.append((round(el, 2), k))
            if shots and shot_at and el >= shot_at[0]:
                await pg.screenshot(path=f"{HERE}/bootvid/{shot_at.pop(0):.1f}.png")
            if skip_at is not None and not skipped and el >= skip_at and k == "animacion":
                await pg.keyboard.press("x")  # X = botón A del mando virtual
                skipped = el
            if el > (4 if skip_at else 9) and k == "consola":
                break
        await pg.wait_for_timeout(50)
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(400)
    await pg.click("[data-action=quit]"); await pg.wait_for_timeout(2500)
    await pg.close()
    return seq, skipped


async def main():
    os.makedirs(HERE + "/bootvid", exist_ok=True)
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        seq, _ = await play(br, shots=True)
        print("secuencia:", seq)
        anim = [t for t, k in seq if k == "animacion"]
        cons = [t for t, k in seq if k == "consola"]
        ok1 = bool(anim) and bool(cons) and min(anim) < 1.5 and min(cons) > 4.0
        seq2, skipped = await play(br, skip_at=1.5)
        print("saltando con un botón:", seq2, "pulsado en", skipped)
        cons2 = [t for t, k in seq2 if k == "consola"]
        ok2 = bool(skipped) and bool(cons2) and min(cons2) - skipped < 2.5
        await br.close()
    print("BOOT_E2E_OK" if ok1 and ok2 else f"BOOT_E2E_FAIL ({ok1}, {ok2})")

asyncio.run(main())
