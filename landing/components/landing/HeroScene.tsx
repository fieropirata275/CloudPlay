"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Nube de partículas (three.js) que se transforma en siluetas genéricas de consola:
 * nube → torre (PS2) → cubo (GameCube) → placa fina (Wii) → nube…
 * Ninguna forma reproduce un diseño ni un logo real: son cajas y esferas.
 * El morph se hace en el vertex shader; la CPU solo cambia los atributos al empezar cada transición.
 */

export const SHAPES = [
  { key: "cloud", label: "Tu nube", color: "#C9D6FF" },
  { key: "ps2", label: "PlayStation 2", color: "#4F6BFF" },
  { key: "gc", label: "GameCube", color: "#8B6DFF" },
  { key: "wii", label: "Wii", color: "#38C5F2" },
] as const;

const COUNT = 6500;
const HOLD = 2.6; // s que se queda cada forma
const MORPH = 1.6; // s que dura la transición

type V3 = [number, number, number];

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

/** Punto aleatorio sobre la superficie de una caja (ponderado por área de cada cara). */
function onBox(w: number, h: number, d: number, skip?: (p: V3) => boolean): V3 {
  const areas = [h * d, h * d, w * d, w * d, w * h, w * h];
  const total = areas.reduce((s, a) => s + a, 0);
  for (;;) {
    let r = Math.random() * total;
    let f = 0;
    while (r > areas[f]) r -= areas[f++];
    const u = rand(-0.5, 0.5);
    const v = rand(-0.5, 0.5);
    let p: V3;
    if (f === 0) p = [w / 2, u * h, v * d];
    else if (f === 1) p = [-w / 2, u * h, v * d];
    else if (f === 2) p = [u * w, h / 2, v * d];
    else if (f === 3) p = [u * w, -h / 2, v * d];
    else if (f === 4) p = [u * w, v * h, d / 2];
    else p = [u * w, v * h, -d / 2];
    if (!skip || !skip(p)) return p;
  }
}

function onSphere(c: V3, r: number): V3 {
  const z = rand(-1, 1);
  const t = rand(0, Math.PI * 2);
  const s = Math.sqrt(1 - z * z);
  return [c[0] + r * s * Math.cos(t), c[1] + r * z, c[2] + r * s * Math.sin(t)];
}

function sample(key: (typeof SHAPES)[number]["key"]): Float32Array {
  const out = new Float32Array(COUNT * 3);
  const balls: { c: V3; r: number }[] = [
    { c: [-0.95, -0.15, 0], r: 0.62 },
    { c: [-0.15, 0.3, 0.05], r: 0.92 },
    { c: [0.8, 0.0, -0.05], r: 0.7 },
    { c: [0.1, -0.35, 0.1], r: 0.62 },
  ];
  const inside = (p: V3, skip: number) =>
    balls.some((b, i) => i !== skip && Math.hypot(p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]) < b.r * 0.98);
  for (let i = 0; i < COUNT; i++) {
    let p: V3;
    if (key === "cloud") {
      for (;;) {
        const bi = Math.floor(Math.random() * balls.length);
        p = onSphere(balls[bi].c, balls[bi].r);
        if (!inside(p, bi) && p[1] > -0.72) break;
      }
      p = [p[0] * 1.1, p[1] * 1.1 + 0.1, p[2] * 0.9];
    } else if (key === "ps2") {
      // Torre con una ranura horizontal
      p = onBox(0.9, 2.3, 1.7, (q) => Math.abs(q[1] - 0.12) < 0.05 && Math.abs(q[2]) < 0.84);
    } else if (key === "gc") {
      // Cubo con un aro en la cara superior
      if (i % 9 === 0) {
        const a = rand(0, Math.PI * 2);
        p = [Math.cos(a) * 0.42, 0.8, Math.sin(a) * 0.42 - 0.1];
      } else p = onBox(1.6, 1.6, 1.6);
    } else {
      // Placa fina en vertical
      p = onBox(0.42, 2.2, 1.8);
    }
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  }
  return out;
}

const vertex = /* glsl */ `
  attribute vec3 posB;
  attribute float delay;
  attribute float seed;
  uniform float uMix;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  varying float vMix;
  varying float vSeed;
  float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
  void main() {
    float t = ease(clamp((uMix - delay) / (1.0 - 0.35), 0.0, 1.0));
    vec3 p = mix(position, posB, t);
    // En mitad del viaje las partículas se abren un poco: se nota que "vuelan"
    p += normalize(p + 0.001) * sin(t * 3.14159) * 0.35 * seed;
    p += vec3(sin(uTime * 0.9 + seed * 40.0), cos(uTime * 0.7 + seed * 23.0), sin(uTime * 0.8 + seed * 11.0)) * 0.012;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.6 + seed) / -mv.z;
    vMix = t;
    vSeed = seed;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vMix;
  varying float vSeed;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    vec3 c = mix(uColorA, uColorB, vMix);
    // Unas pocas chispas ámbar, como el LED de encendido
    c = mix(c, vec3(1.0, 0.69, 0.0), step(0.965, vSeed));
    gl_FragColor = vec4(c, a * uOpacity * (0.55 + 0.45 * vSeed));
  }
`;

export function HeroScene({ onShape, className }: { onShape?: (i: number) => void; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onShape);
  cb.current = onShape;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
    } catch {
      return; // sin WebGL: la portada sigue funcionando sin la escena
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 0, 6.2);

    const shapes = SHAPES.map((s) => sample(s.key));
    const colors = SHAPES.map((s) => new THREE.Color(s.color));
    const geo = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(shapes[0].slice(), 3);
    const posB = new THREE.BufferAttribute(shapes[1].slice(), 3);
    const delay = new Float32Array(COUNT);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      seed[i] = Math.random();
      delay[i] = Math.random() * 0.35;
    }
    geo.setAttribute("position", posA);
    geo.setAttribute("posB", posB);
    geo.setAttribute("delay", new THREE.BufferAttribute(delay, 1));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));

    const uniforms = {
      uMix: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: 26 },
      uPixelRatio: { value: dpr },
      uOpacity: { value: 0 },
      uColorA: { value: colors[0].clone() },
      uColorB: { value: colors[1].clone() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    const group = new THREE.Group();
    group.add(points);
    group.rotation.set(0.25, -0.5, 0);
    scene.add(group);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // En pantallas estrechas la cámara se aleja para que la figura no se corte
      camera.position.z = w < 640 ? 8 : 6.2;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Ratón → inclinación suave del grupo
    const target = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 0.6;
      target.y = (e.clientY / window.innerHeight - 0.5) * 0.4;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let current = 0; // forma de origen
    let phase: "hold" | "morph" = "hold";
    let phaseStart = 0;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    cb.current?.(0);

    const startMorph = () => {
      const next = (current + 1) % shapes.length;
      posA.array.set(shapes[current]);
      posB.array.set(shapes[next]);
      posA.needsUpdate = true;
      posB.needsUpdate = true;
      uniforms.uColorA.value.copy(colors[current]);
      uniforms.uColorB.value.copy(colors[next]);
      uniforms.uMix.value = 0;
      phase = "morph";
      phaseStart = clock;
      cb.current?.(next);
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      clock += dt;
      uniforms.uTime.value = clock;
      uniforms.uOpacity.value = Math.min(1, uniforms.uOpacity.value + dt * 0.9);

      if (phase === "hold" && clock - phaseStart > HOLD) startMorph();
      else if (phase === "morph") {
        const t = (clock - phaseStart) / MORPH;
        uniforms.uMix.value = Math.min(1, t);
        if (t >= 1) {
          current = (current + 1) % shapes.length;
          // Queda en la forma de destino: la siguiente transición parte de aquí
          posA.array.set(shapes[current]);
          posA.needsUpdate = true;
          uniforms.uColorA.value.copy(colors[current]);
          uniforms.uMix.value = 0;
          phase = "hold";
          phaseStart = clock;
        }
      }

      group.rotation.y += dt * 0.18;
      group.rotation.x += (0.25 + target.y - group.rotation.x) * 0.04;
      group.position.x += (target.x * 0.6 - group.position.x) * 0.04;

      renderer.render(scene, camera);
      if (visible) raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      uniforms.uOpacity.value = 1;
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(frame);
    }

    // Fuera de pantalla o con la pestaña oculta no se dibuja nada
    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting && document.visibilityState === "visible";
      if (!reduced && visible && !was) {
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(el);
    const onVis = () => {
      const was = visible;
      visible = document.visibilityState === "visible";
      if (!reduced && visible && !was) {
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} aria-hidden="true" className={className} />;
}
