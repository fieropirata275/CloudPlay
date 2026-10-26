// E2E de la app de escritorio: abre CloudPlay (Electron) contra el servidor de pruebas, entra y juega.
// Lo lanza run.sh con E2E_DESKTOP=1 (el cliente se copia con CLOUDPLAY_SERVER=http://localhost:8077).
const path = require('path');
const { _electron: electron } = require('playwright');

(async () => {
  const appDir = path.join(__dirname, '..', '..', 'clients', 'desktop');
  const app = await electron.launch({ executablePath: require(path.join(appDir, 'node_modules', 'electron')), args: ['--no-sandbox', appDir],
                                      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' } });
  const pg = await app.firstWindow();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.waitForSelector('#email', { timeout: 20000 });
  await pg.fill('#email', 'admin@local'); await pg.fill('#password', 'devpassword');
  await pg.click('#login-form button[type=submit]');
  await pg.waitForSelector('#grid .tile', { timeout: 20000 });
  await pg.screenshot({ path: path.join(__dirname, 'desktop_library.png') });
  await pg.click('.filter[data-platform=ps2]'); await pg.waitForTimeout(400);
  await pg.click('#grid .tile >> nth=0');
  if (await pg.isVisible('#acc-go')) await pg.click('#acc-go');
  let ok = false, st = null;
  for (let i = 0; i < 40; i++) {
    await pg.waitForTimeout(500);
    st = await pg.evaluate(() => ({ w: video.videoWidth, t: video.currentTime, boot: document.querySelector('#boot').hidden }));
    if (st.w > 0 && st.t > 1 && st.boot) { ok = true; break; }
  }
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(__dirname, 'desktop_play.png') });
  const origin = await pg.evaluate(() => location.origin + ' · servidor ' + CP.serverUrl());
  console.log('app de escritorio:', origin, '· vídeo:', JSON.stringify(st), '· errores:', errs.length ? errs : 'ninguno');
  console.log(ok && !errs.length ? 'DESKTOP_E2E_OK' : 'DESKTOP_E2E_FAIL');
  await app.close();
})();
