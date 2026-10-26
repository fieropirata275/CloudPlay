/* CloudPlay de escritorio: el cliente web dentro de una ventana propia, con los permisos que en el navegador
 * hay que conceder a mano ya resueltos. Así el Wiimote, la Balance Board, el micro y la cámara funcionan nada más
 * conectarlos, como en un emulador local, aunque la consola esté en la nube. */
const { app, BrowserWindow, protocol, net, session, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, 'web');
const NINTENDO = 0x057e;
const WII_PIDS = [0x0306, 0x0330];

// app://cloudplay/... sirve el cliente: contexto seguro (WebHID, micro, cámara) sin servidor local
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

if (!app.requestSingleInstanceLock()) app.quit();

function isWii(d) { return d && d.vendorId === NINTENDO && WII_PIDS.includes(d.productId); }

function setupPermissions(ses) {
  // Micro (SingStar, micro de GameCube), cámara (EyeToy), mandos HID, pantalla completa
  const allowed = new Set(['media', 'hid', 'fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  // Wiimotes y Balance Board: permiso permanente, el cliente los vincula solo sin preguntar
  ses.setDevicePermissionHandler((d) => d.deviceType === 'hid' && isWii(d.device));
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const dev = details.deviceList.find(isWii);
    callback(dev ? dev.deviceId : '');
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'CloudPlay',
    backgroundColor: '#0b0d2b',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'web', 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: false }
  });
  // Enlaces externos (ayuda, Cloudflare...) al navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
  });
  win.loadURL('app://cloudplay/index.html');
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(WEB, p === '/' ? 'index.html' : p));
    if (!file.startsWith(WEB)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  setupPermissions(session.defaultSession);
  const win = createWindow();
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
});

app.on('window-all-closed', () => app.quit());
