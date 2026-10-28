// Renderiza la animación de arranque de cada consola a bootsplash/<consola>.webm (VP9 + Opus, 1280x720@60).
//   npm i && node render.mjs [ps2 gc wii] [--stills]
// Necesita Chromium (Playwright), ffmpeg con libvpx-vp9/libopus y python3 con numpy (el sonido sale de jingle.py).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');           // raíz del repo (fuentes de clients/web)
const OUT = path.resolve(HERE, '..');
const FPS = 60;
const args = process.argv.slice(2);
const stills = args.includes('--stills');
const platforms = args.filter(a => !a.startsWith('--'));
const list = platforms.length ? platforms : ['ps2', 'gc', 'wii'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const platform of list) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.error('error en la página:', e.message));
  await page.goto(`http://127.0.0.1:${port}/worker/session/bootsplash/studio/splash.html?platform=${platform}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  const dur = await page.evaluate(() => window.DURATION);
  const dir = fs.mkdtempSync(path.join(HERE, `.frames-${platform}-`));
  const times = stills ? [0.5, 1.2, 2.0, 2.8, 3.3, 3.6, 4.1, 4.4, 4.8] : [...Array(Math.round(dur * FPS)).keys()].map(i => i / FPS);
  const t0 = Date.now();
  for (let i = 0; i < times.length; i++) {
    await page.evaluate(t => window.frame(t), times[i]);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.png`) });
    if (i % 60 === 0) console.log(`${platform}: ${i}/${times.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  await page.close();
  if (stills) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, '%04d.png'), '-vf', 'scale=640:-1,tile=3x3',
      path.join(HERE, `stills-${platform}.png`)]);
    console.log(`stills-${platform}.png`);
  } else {
    const wav = path.join(dir, 'jingle.wav');
    execFileSync('python3', [path.join(HERE, 'jingle.py'), platform, String(dur), wav]);
    const out = path.join(OUT, `${platform}.webm`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'), '-i', wav,
      '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
      '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'libopus', '-b:a', '128k', '-shortest', out]);
    console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
await browser.close();
server.close();
