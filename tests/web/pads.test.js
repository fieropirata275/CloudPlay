// Pruebas del motor de mandos (clients/web/js/pads.js) con mandos simulados: node tests/web/pads.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const store = {};
let pads = [];
let frames = [];
global.window = global;
Object.defineProperty(global, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', getGamepads: () => pads }, configurable: true });
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
global.cancelAnimationFrame = () => {};
global.addEventListener = () => {};
require(path.join(__dirname, '../../clients/web/js/padsdb.js'));
const P = require(path.join(__dirname, '../../clients/web/js/pads.js'));
const tick = (n = 3) => { for (let i = 0; i < n; i++) { const f = frames; frames = []; f.forEach((fn) => fn()); } };

function pad(id, nb, na, extra) {
  const gp = { id, index: 0, mapping: '', connected: true, buttons: [], axes: new Array(na).fill(0) };
  for (let i = 0; i < nb; i++) gp.buttons.push({ pressed: false, value: 0 });
  return Object.assign(gp, extra || {});
}
const press = (gp, i, on = true) => { gp.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
const bit = (st, b) => (st.buttons >> b) & 1;
let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('  ✓ ' + name); };

t('hat de 8 posiciones en un eje (Chrome Windows/macOS)', () => {
  const exp = [[-1, 1], [-0.714, 3], [-0.428, 2], [-0.142, 6], [0.142, 4], [0.428, 12], [0.714, 8], [1, 9], [1.2857, 0], [3.2857, 0]];
  exp.forEach(([v, b]) => assert.strictEqual(P.hatFromAxis(v), b, 'valor ' + v));
});

t('id de Chrome y de Firefox -> vendor/product', () => {
  assert.strictEqual(P.vidpid('MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1846)'), '00791846');
  assert.strictEqual(P.vidpid('79-1846-MAYFLASH GameCube Controller Adapter'), '00791846');
  assert.strictEqual(P.vidpid('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), null);
});

t('mando estándar: se lee tal cual', () => {
  const gp = pad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 17, 4, { mapping: 'standard' });
  press(gp, 0); press(gp, 14); gp.axes[2] = 0.8; gp.buttons[7] = { pressed: true, value: 0.9 };
  const st = P.read(gp);
  assert.strictEqual(P.describe(gp).kind, 'standard');
  assert.ok(bit(st, 0) && bit(st, 14) && bit(st, 7));
  assert.strictEqual(st.rx, 0.8);
  assert.strictEqual(st.rt, 0.9);
});

t('adaptador GameCube Mayflash (Windows): perfil automático de SDL', () => {
  const gp = pad('MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1846)', 16, 10);
  gp.axes[9] = 1.2857;         // hat suelto
  gp.axes[3] = -1; gp.axes[4] = -1;  // gatillos en reposo
  const d = P.describe(gp);
  assert.strictEqual(d.kind, 'profile');
  let st = P.read(gp);
  assert.strictEqual(st.buttons, 0, 'en reposo no hay nada pulsado');
  assert.strictEqual(st.lt, 0);
  press(gp, 1);                // botón A del adaptador
  gp.axes[9] = -1;             // cruceta arriba
  gp.axes[3] = 1;              // gatillo L a fondo
  st = P.read(gp);
  assert.ok(bit(st, 0), 'A -> bit 0');
  assert.ok(bit(st, 12), 'cruceta arriba');
  assert.strictEqual(st.lt, 1);
  assert.ok(bit(st, 6), 'L a fondo también como botón');
});

t('asistente con un adaptador de PS2 desconocido (cruceta en eje, stick derecho Z/Rz)', () => {
  const gp = pad('Generic USB Joystick (Vendor: 1234 Product: 5678)', 12, 10);
  gp.axes[9] = 1.2857;
  pads = [gp];
  assert.strictEqual(P.describe(gp).kind, 'unknown');
  let done = null;
  const w = new P.Wizard({ index: 0, layout: 'ps2', onStep: () => {}, onDone: (m) => { done = m; } });
  w.start(); tick();
  // ✕ ◯ □ △ L1 R1 -> botones 2 1 3 0 6 7 del adaptador
  const btns = [2, 1, 3, 0, 6, 7];
  const act = (fn, undo) => { fn(); tick(); undo(); tick(); };
  btns.forEach((b) => act(() => press(gp, b), () => press(gp, b, false)));
  act(() => press(gp, 4), () => press(gp, 4, false));   // L2 es un botón
  act(() => press(gp, 5), () => press(gp, 5, false));   // R2
  act(() => press(gp, 8), () => press(gp, 8, false));   // SELECT
  act(() => press(gp, 9), () => press(gp, 9, false));   // START
  [-1, 0.142, 0.714, -0.428].forEach((v) => act(() => { gp.axes[9] = v; }, () => { gp.axes[9] = 1.2857; }));  // ↑ ↓ ← →
  act(() => { gp.axes[0] = 1; }, () => { gp.axes[0] = 0; });   // stick izq. derecha
  act(() => { gp.axes[1] = 1; }, () => { gp.axes[1] = 0; });   // abajo
  act(() => { gp.axes[2] = 1; }, () => { gp.axes[2] = 0; });   // stick der. derecha (Z)
  act(() => { gp.axes[5] = -1; }, () => { gp.axes[5] = 0; });  // abajo (Rz invertido)
  act(() => press(gp, 10), () => press(gp, 10, false));        // L3
  act(() => press(gp, 11), () => press(gp, 11, false));        // R3
  w.skip(); tick();                                            // sin botón Home
  assert.ok(done, 'terminó');
  assert.match(done, /12:h9\.1/, 'cruceta convertida a hat con diagonales');
  P.save(gp, done);
  assert.strictEqual(P.describe(gp).kind, 'custom');
  press(gp, 2); gp.axes[9] = 0.428; gp.axes[5] = -0.5; press(gp, 4);
  const st = P.read(gp);
  assert.ok(bit(st, 0), '✕');
  assert.ok(bit(st, 13) && bit(st, 14), 'diagonal abajo-izquierda');
  assert.ok(Math.abs(st.ry - 0.5) < 1e-9, 'stick derecho abajo (eje invertido)');
  assert.ok(bit(st, 6), 'L2');
  assert.ok(!bit(st, 1) && !bit(st, 3), 'nada más');
});

t('soltar el stick del paso anterior no cuenta como el paso siguiente', () => {
  const gp = pad('Otro (Vendor: 1111 Product: 2222)', 4, 4);
  pads = [gp];
  const seen = [];
  const w = new P.Wizard({ index: 0, layout: 'std', onStep: (s) => seen.push(s.slot), onDone: () => {} });
  w.start(); tick();
  for (let i = 0; i < 14; i++) w.skip();
  tick();
  gp.axes[0] = 1; tick();      // lx -> a0
  assert.strictEqual(w.map.lx, 'a0');
  tick(); gp.axes[0] = 0; tick(); // al soltar vuelve a reposo: no se asigna nada a "ly"
  assert.strictEqual(w.map.ly, undefined);
  gp.axes[1] = 1; tick();
  assert.strictEqual(w.map.ly, 'a1');
  w.stop();
});

t('gatillo analógico en un eje que reposa en -1', () => {
  const gp = pad('Trig (Vendor: 3333 Product: 4444)', 2, 6);
  gp.axes[4] = -1;
  pads = [gp];
  const base = P.snapshot(gp);
  gp.axes[4] = 1;
  const tok = P.detect(gp, base, 'lt', {});
  assert.strictEqual(tok, 'a4:-1:1');
  P.save(gp, 'lt:' + tok);
  gp.axes[4] = 0;
  assert.strictEqual(P.read(gp).lt, 0.5);
});

t('receptor de Buzz!: un dispositivo, 4 jugadores', () => {
  const gp = pad('Buzz (Vendor: 054c Product: 0002)', 20, 0);
  const ps = P.players([gp]);
  assert.strictEqual(ps.length, 4);
  press(gp, 0);       // jugador 1: rojo
  press(gp, 5 + 4);   // jugador 2: azul
  press(gp, 15 + 3);  // jugador 4: naranja
  assert.strictEqual(P.read(ps[0]).buttons, 1 << 0, 'rojo = ✕/A');
  assert.strictEqual(P.read(ps[1]).buttons, 1 << 3, 'azul = △/Y');
  assert.strictEqual(P.read(ps[2]).buttons, 0);
  assert.strictEqual(P.read(ps[3]).buttons, 1 << 1, 'naranja = ◯/B');
});

console.log(ok + ' pruebas OK');
