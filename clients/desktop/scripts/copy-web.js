// Copia el cliente web (el mismo que usan el navegador y las teles) dentro de la app de escritorio.
//   CLOUDPLAY_SERVER=https://play.empresa.com npm run web   -> la app ya viene apuntando a ese servidor
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'web');
const dst = path.join(__dirname, '..', 'web');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
const server = process.env.CLOUDPLAY_SERVER || '';
fs.writeFileSync(path.join(dst, 'js', 'config.js'),
  '/* App de escritorio: servidor por defecto (se puede cambiar en la pantalla de entrada) */\n' +
  'window.CP_CONFIG = { server: ' + JSON.stringify(server) + ', desktop: true };\n');
console.log('cliente web copiado' + (server ? ' (servidor ' + server + ')' : ''));
