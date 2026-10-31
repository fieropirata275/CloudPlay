// Panel de correo y "¿Has olvidado la contraseña?" con el cliente web real (devserver + Resend falso).
//   node ui_mail.mjs API_URL FAKE_URL OUT_DIR      → imprime UI_MAIL_OK
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/');
const { chromium } = require('playwright');
const [API, FAKE, OUT] = process.argv.slice(2);
const state = () => fetch(FAKE + '/_state').then(r => r.json());
const fail = (m) => { console.log('FALLO: ' + m); process.exit(1); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.goto(API + '/#/login');
await pg.fill('#email', 'admin@local'); await pg.fill('#password', 'devpassword');
await pg.click('#login-form button[type=submit]');
await pg.waitForFunction(() => location.hash.indexOf('#/library') === 0);
await pg.goto(API + '/#/admin');
await pg.waitForSelector('#mail-kinds input[data-kind]');
const sys = await pg.textContent('#sys-card');
if (!/Solo en tu red local/.test(sys) || !/sudo cloudplay cloudflare/.test(sys)) fail('tarjeta de Internet: ' + sys);
const card = await pg.textContent('#mail-card');
if (!/Resend/.test(card) || !/no-reply@tudominio.com/.test(card)) fail('tarjeta de correo: ' + card);
// Desactivar la bienvenida y avisar al NOC en otra dirección
await pg.uncheck('#mail-kinds input[data-kind=welcome]');
await pg.fill('#mail-notify', 'noc@tudominio.com');
await pg.click('#mail-save');
await pg.waitForFunction(() => /guardados/.test(document.getElementById('toast').textContent));
// Prueba desde el panel
await pg.fill('#mail-test-to', 'panel@tudominio.com');
await pg.click('#mail-test');
await pg.waitForFunction(() => /Prueba enviada/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
let s = await state();
if (!s.emails.some(e => e.to[0] === 'panel@tudominio.com')) fail('la prueba del panel no salió');
await pg.waitForSelector('#mail-log tbody tr');
await pg.selectOption('#mail-preview-kind', 'reset');
await pg.waitForFunction(() => /Recupera tu contraseña/.test(document.getElementById('mail-preview').getAttribute('srcdoc') || ''));
await pg.waitForTimeout(400);
await pg.locator('#sys-card').scrollIntoViewIfNeeded();
await pg.locator('#mail-card').scrollIntoViewIfNeeded();
await pg.evaluate(() => window.scrollBy(0, -80));
await pg.screenshot({ path: OUT + '/panel-correo.png' });
await pg.locator('#sys-card').evaluate(e => e.scrollIntoView());
await pg.evaluate(() => window.scrollBy(0, -60));
await pg.screenshot({ path: OUT + '/panel-internet.png' });

// Recuperar la contraseña desde el login
await pg.goto(API + '/#/library');
await pg.click('#logout');
await pg.waitForSelector('#forgot-btn:not([hidden])');
await pg.click('#forgot-btn');
await pg.fill('#forgot-email', 'admin@local');
await pg.click('#forgot-form button[type=submit]');
await pg.waitForFunction(() => /te acaba de llegar el enlace/.test(document.getElementById('forgot-msg').textContent));
await pg.screenshot({ path: OUT + '/login-olvidada.png' });
let link = null;
for (let i = 0; i < 50 && !link; i++) {
  s = await state();
  const m = s.emails.filter(e => /Recupera/.test(e.subject)).pop();
  if (m) link = /(http:\/\/\S+#\/reset\?token=[\w-]+)/.exec(m.text)[1];
  else await new Promise(r => setTimeout(r, 100));
}
if (!link) fail('no llegó el correo de recuperar');
await pg.goto(API + link.slice(link.indexOf('/#/')));  // el enlace lleva la URL pública
await pg.waitForSelector('#screen-reset.active');
await pg.fill('#reset-pass', 'clave-nueva-1'); await pg.fill('#reset-pass2', 'clave-nueva-1');
await pg.screenshot({ path: OUT + '/contrasena-nueva.png' });
await pg.click('#reset-form button[type=submit]');
await pg.waitForFunction(() => location.hash.indexOf('#/library') === 0);
const r = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@local', password: 'clave-nueva-1' }) });
if (r.status !== 200) fail('la contraseña nueva no entra');
s = await state();
if (!s.emails.some(e => /ha cambiado/.test(e.subject))) fail('falta el aviso de contraseña cambiada');
if (errors.length) fail('errores de JS: ' + errors.join(' | '));
await b.close();
console.log('UI_MAIL_OK');
