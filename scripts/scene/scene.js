/* Fondo ambiental de la app (three.js): un campo de partículas que viaja hacia la cámara.
 * Se tiñe con la plataforma elegida y entra en "warp" mientras arranca un juego.
 * Se compila a vendor/cp-scene.min.js (IIFE, global CPScene) con scripts/vendor.sh. */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Mesh, PerspectiveCamera,
  PlaneGeometry, Points, Scene, ShaderMaterial, WebGLRenderer,
} from "three";

const COUNT = 2200;
const DEPTH = 70;

const pointsVS = `
  attribute float seed;
  uniform float uTravel;
  uniform float uSize;
  uniform float uWarp;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec3 p = position;
    p.z = mod(p.z + uTravel * (0.6 + seed * 0.8), ${DEPTH.toFixed(1)}) - ${(DEPTH - 6).toFixed(1)};
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    gl_PointSize = uSize * (0.5 + seed) * (1.0 + uWarp * 1.6) / dist;
    // aparecen a lo lejos y se apagan justo antes de tocar la cámara
    vFade = smoothstep(${DEPTH.toFixed(1)}, 40.0, dist) * smoothstep(0.5, 6.0, dist);
    vSeed = seed;
  }
`;
const pointsFS = `
  uniform vec3 uTint;
  uniform float uAlpha;
  uniform float uWarp;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    // en warp los puntos se estiran en vertical: parecen estelas
    c.y /= (1.0 + uWarp * 2.5);
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    vec3 col = mix(vec3(0.91, 0.95, 1.0), uTint, 0.55 + 0.45 * vSeed);
    col = mix(col, vec3(1.0, 0.69, 0.0), step(0.97, vSeed));
    gl_FragColor = vec4(col, a * vFade * uAlpha * (0.35 + 0.65 * vSeed));
  }
`;
const glowVS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const glowFS = `
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 a = vec2(0.32 + 0.06 * sin(uTime * 0.11), 0.62 + 0.05 * cos(uTime * 0.13));
    vec2 b = vec2(0.72 + 0.05 * cos(uTime * 0.09), 0.35 + 0.06 * sin(uTime * 0.12));
    float g1 = smoothstep(0.45, 0.0, distance(vUv, a));
    float g2 = smoothstep(0.38, 0.0, distance(vUv, b));
    vec3 col = uTint * g1 * 0.55 + vec3(0.36, 0.29, 0.84) * g2 * 0.5;
    gl_FragColor = vec4(col, (g1 * 0.5 + g2 * 0.45) * uAlpha);
  }
`;

function start(canvas, opts) {
  opts = opts || {};
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(0, 0, 6);

  const pos = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 60;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 36;
    pos[i * 3 + 2] = Math.random() * DEPTH;
    seed[i] = Math.random();
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("seed", new BufferAttribute(seed, 1));

  const tint = new Color(opts.tint || "#5B4BD6");
  const tintTarget = tint.clone();
  const u = {
    uTravel: { value: 0 },
    uSize: { value: 70 * dpr },
    uWarp: { value: 0 },
    uTint: { value: tint },
    uAlpha: { value: 0 },
  };
  const mat = new ShaderMaterial({ vertexShader: pointsVS, fragmentShader: pointsFS, uniforms: u, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  const gu = { uTint: { value: tint }, uTime: { value: 0 }, uAlpha: { value: 0 } };
  const glow = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({ vertexShader: glowVS, fragmentShader: glowFS, uniforms: gu, transparent: true, depthWrite: false }));
  glow.position.z = -40;
  scene.add(glow);

  let level = 1, levelTarget = 1, speed = 1.2, speedTarget = 1.2, fovTarget = 60, warp = 0, warpTarget = 0;
  const ptr = { x: 0, y: 0 };
  const onMove = (e) => {
    ptr.x = (e.clientX / window.innerWidth - 0.5) * 2;
    ptr.y = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // el plano del brillo siempre cubre la vista
    const hh = 2 * Math.tan((camera.fov * Math.PI) / 360) * 46;
    glow.scale.set(hh * camera.aspect * 1.2, hh * 1.2, 1);
  };
  resize();
  window.addEventListener("resize", resize);

  let raf = 0, running = false, last = 0, t = 0;
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    const k = 1 - Math.pow(0.02, dt); // suavizado independiente de los fps
    speed += (speedTarget - speed) * k;
    warp += (warpTarget - warp) * k;
    level += (levelTarget - level) * k;
    tint.lerp(tintTarget, k * 0.8);
    u.uTravel.value += dt * speed;
    u.uWarp.value = warp;
    u.uAlpha.value = Math.min(level, u.uAlpha.value + dt * 0.8);
    gu.uAlpha.value = u.uAlpha.value * 0.9;
    gu.uTime.value = t;
    if (Math.abs(camera.fov - fovTarget) > 0.05) {
      camera.fov += (fovTarget - camera.fov) * k;
      camera.updateProjectionMatrix();
    }
    camera.position.x += (ptr.x * 1.4 - camera.position.x) * k * 0.5;
    camera.position.y += (-ptr.y * 0.9 - camera.position.y) * k * 0.5;
    camera.lookAt(0, 0, -30);
    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  };

  const api = {
    resume() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    pause() {
      running = false;
      cancelAnimationFrame(raf);
    },
    setTint(hex) { tintTarget.set(hex); },
    setLevel(v) { levelTarget = v; },
    warp(on) {
      warpTarget = on ? 1 : 0;
      speedTarget = on ? 46 : 1.2;
      fovTarget = on ? 84 : 60;
    },
    destroy() {
      api.pause();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", resize);
      geo.dispose(); mat.dispose(); renderer.dispose();
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (running) { api.pause(); api._wasRunning = true; } }
    else if (api._wasRunning) { api._wasRunning = false; api.resume(); }
  });
  if (opts.reduced) { u.uAlpha.value = level; renderer.render(scene, camera); }
  else api.resume();
  return api;
}

window.CPScene = { start };
