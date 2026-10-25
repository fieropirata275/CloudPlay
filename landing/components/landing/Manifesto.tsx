"use client";

import { motion, type MotionValue, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

const TEXT =
  "Los juegos que marcaron una generación no deberían depender de una consola guardada en un cajón. CloudPlay los pone en la pantalla que ya tienes delante, con el mando que ya tienes en la mano.";
const HOT = new Set(["generación", "cajón.", "pantalla", "mando"]);

function Word({ word, range, progress }: { word: string; range: [number, number]; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, range, [0.12, 1]);
  const y = useTransform(progress, range, [12, 0]);
  const blur = useTransform(progress, range, [6, 0]);
  const filter = useTransform(blur, (b) => `blur(${b}px)`);
  return (
    <span className="relative mr-[0.28em] inline-block">
      <motion.span style={{ opacity, y, filter }} className={HOT.has(word) ? "text-led" : undefined}>
        {word}
      </motion.span>
    </span>
  );
}

/** Manifiesto que se "enciende" palabra a palabra con el scroll (sección fija mientras dura). */
export function Manifesto() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const words = TEXT.split(" ");
  const glow = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 0.3]);
  return (
    <section ref={ref} aria-label="Por qué CloudPlay" className="relative h-[260vh]">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <motion.div
          aria-hidden="true"
          style={{ opacity: glow }}
          className="pointer-events-none absolute left-1/2 top-1/2 size-[70vmax] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(91,75,214,0.28),transparent_60%)]"
        />
        <p className="sr-only">{TEXT}</p>
        <p aria-hidden="true" className="relative mx-auto max-w-5xl px-5 font-display text-[clamp(1.8rem,4.6vw,4rem)] font-extrabold leading-[1.12] tracking-[-0.02em]">
          {words.map((w, i) => {
            const start = (i / words.length) * 0.85;
            return <Word key={i} word={w} progress={scrollYProgress} range={[start, start + 0.85 / words.length + 0.04]} />;
          })}
        </p>
      </div>
    </section>
  );
}
