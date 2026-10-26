// Comprobación sin pantalla: arranca la app, espera a que cargue el cliente y mira que WebHID, el micro y el
// gamepad están disponibles y que no hay errores. Uso: xvfb-run npm run check
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');
const probe = `
const { app, BrowserWindow } = require('electron');
require(${JSON.stringify(path.join(__dirname, '..', 'main.js'))});
app.on('browser-window-created', (_e, win) => {
  const errs = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errs.push(e.message); });
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await win.webContents.executeJavaScript(\`({
      title: document.title, hid: !!navigator.hid, media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      gamepad: !!navigator.getGamepads, secure: window.isSecureContext, wii: !!(window.CP && CP.WiiLink && CP.WiiLink.supported),
      desktop: !!(window.CP_CONFIG && CP_CONFIG.desktop), screen: (document.querySelector('.screen.active') || {}).id
    })\`);
    console.log('CHECK ' + JSON.stringify(r) + ' errores=' + JSON.stringify(errs));
    app.quit();
  });
});`;
const fs = require('fs');
const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudplay-check-'));
fs.writeFileSync(path.join(tmp, 'probe.js'), probe);
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'cloudplay-check', main: 'probe.js' }));
const p = spawn(electron, ['--no-sandbox', tmp], { stdio: 'inherit' });
p.on('exit', (c) => process.exit(c || 0));
