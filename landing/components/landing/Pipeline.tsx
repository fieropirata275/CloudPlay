"use client";

import { motion, type MotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { Cpu, Film, Gamepad2, Server, Tv, Wifi, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

const STAGES: { icon: LucideIcon; title: string; text: string; tag: string }[] = [
  { icon: Gamepad2, tag: "Mando", title: "Pulsas un botón", text: "El mando táctil, el de la tele o uno Bluetooth manda la pulsación por un canal de datos WebRTC." },
  { icon: Wifi, tag: "Red", title: "Viaja por la red", text: "Va directa al nodo, o pasa por el servidor TURN si hay un router con NAT de por medio." },
  { icon: Server, tag: "Nodo", title: "El nodo la recibe", text: "Un mando virtual de Linux (uinput) se la entrega al emulador como si fuera un mando físico." },
  { icon: Cpu, tag: "GPU", title: "La GPU dibuja el fotograma", text: "PCSX2 o Dolphin renderizan a la resolución que elijas, acelerados por la GPU del servidor." },
  { icon: Film, tag: "Vídeo", title: "Se comprime en H.264", text: "GStreamer codifica cada fotograma y lo envía junto al audio en Opus." },
  { icon: Tv, tag: "Pantalla", title: "Llega a tu pantalla", text: "Hasta 60 fotogramas por segundo en la tele, el móvil o el navegador. Y vuelta a empezar." },
];

function Stage({ i, progress, s }: { i: number; progress: MotionValue<number>; s: (typeof STAGES)[number] }) {
  const c = i / (STAGES.length - 1);
  const w = 0.6 / (STAGES.length - 1);
  const opacity = useTransform(progress, [c - w, c, c + w], [0.45, 1, 0.45]);
  const scale = useTransform(progress, [c - w, c, c + w], [0.9, 1, 0.9]);
  const iconRotate = useTransform(progress, [c - w, c, c + w], [-25, 0, 25]);
  const iconScale = useTransform(progress, [c - w, c, c + w], [0.7, 1.15, 0.7]);
  const lit = useTransform(progress, [c - w / 2, c], [0, 1]);
  const Icon = s.icon;
  return (
    <motion.article style={{ opacity, scale }} className="relative flex w-[82vw] shrink-0 flex-col justify-center sm:w-[60vw] lg:w-[44vw]">
      <div className="mb-8 flex items-center gap-4">
        <motion.span
          style={{ rotate: iconRotate, scale: iconScale }}
          className="relative grid size-16 place-items-center rounded-2xl bg-ink-2 ring-1 ring-ink-3"
        >
          <motion.span style={{ opacity: lit }} className="absolute inset-0 rounded-2xl bg-led/15 ring-1 ring-led/60" />
          <Icon className="relative size-8 text-glass" strokeWidth={1.6} />
        </motion.span>
        <span className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-mist">
          {String(i + 1).padStart(2, "0")} · {s.tag}
        </span>
      </div>
      <h3 className="font-display text-[clamp(2rem,4.4vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">{s.title}</h3>
      <p className="mt-5 max-w-md text-lg text-mist">{s.text}</p>
    </motion.article>
  );
}

/** Scroll vertical → recorrido horizontal: un "paquete" viaja del mando a la pantalla por las 6 etapas. */
export function Pipeline() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.0005 });
  const x = useTransform(p, (v) => -v * distance);
  const fill = useTransform(p, [0, 1], [0, 1]);
  const dotLeft = useTransform(p, (v) => `${v * 100}%`);

  useLayoutEffect(() => {
    const measure = () => {
      if (track.current) setDistance(Math.max(0, track.current.scrollWidth - window.innerWidth));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <section ref={section} aria-labelledby="pipeline-title" className="relative h-[520vh]">
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-5">
          <h2 id="pipeline-title" className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-led">
            Del botón a la pantalla, en milisegundos
          </h2>
        </div>
        <motion.div ref={track} style={{ x }} className="relative mt-10 flex w-max gap-[8vw] px-[9vw] sm:px-[20vw] lg:px-[28vw]">
          {/* Línea del recorrido y el paquete que viaja por ella */}
          <div aria-hidden="true" className="absolute left-0 right-0 top-8 -z-10 h-px bg-ink-3">
            <motion.div style={{ scaleX: fill }} className="h-full origin-left bg-gradient-to-r from-plastic via-wii to-led" />
            <motion.span
              style={{ left: dotLeft }}
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-led shadow-[0_0_24px_6px_rgba(255,176,0,0.6)]"
            />
          </div>
          {STAGES.map((s, i) => (
            <Stage key={s.title} i={i} s={s} progress={p} />
          ))}
        </motion.div>
        <div aria-hidden="true" className="mx-auto mt-12 flex w-full max-w-6xl gap-2 px-5">
          {STAGES.map((s, i) => (
            <Pip key={s.tag} i={i} progress={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Pip({ i, progress }: { i: number; progress: MotionValue<number> }) {
  const c = i / (STAGES.length - 1);
  const w = 0.5 / (STAGES.length - 1);
  const width = useTransform(progress, [c - w, c, c + w], [12, 44, 12]);
  const bg = useTransform(progress, [c - w, c, c + w], ["#262A6E", "#FFB000", "#262A6E"]);
  return <motion.span style={{ width, backgroundColor: bg }} className="h-1.5 rounded-full" />;
}
