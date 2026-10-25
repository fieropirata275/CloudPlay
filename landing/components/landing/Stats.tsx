"use client";

import NumberFlow from "@number-flow/react";
import { motion, type MotionValue, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { useInView } from "react-intersection-observer";

const STATS = [
  { value: 60, suffix: " fps", label: "de vídeo H.264 por WebRTC" },
  { value: 4, suffix: "", label: "mandos a la vez por partida" },
  { value: 3, suffix: "", label: "consolas: PS2, GameCube y Wii" },
  { value: 5, suffix: "", label: "pantallas: Android, Android TV, Samsung, LG y web" },
];

/** Inspirado en Skiper37: los números cuentan hasta su valor cuando entran en pantalla (NumberFlow). */
function Stat({ value, suffix, label, i, progress }: (typeof STATS)[number] & { i: number; progress: MotionValue<number> }) {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.6 });
  // Cada columna se desplaza a una velocidad distinta
  const y = useTransform(progress, [0, 1], [60 + i * 40, -(20 + i * 30)]);
  return (
    <motion.div
      ref={ref}
      style={{ y }}
      initial={{ opacity: 0, scale: 0.85, filter: "blur(10px)" }}
      whileInView={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ type: "spring", stiffness: 140, damping: 18, delay: i * 0.08 }}
      className="relative pt-6"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-ink-3" />
      <motion.span
        aria-hidden="true"
        className="absolute left-0 top-0 h-px w-full origin-left bg-led"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1], delay: 0.2 + i * 0.12 }}
      />
      <p className="font-display text-6xl font-extrabold tracking-[-0.03em] text-glass">
        <NumberFlow value={inView ? value : 0} suffix={suffix} transformTiming={{ duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" }} />
      </p>
      <p className="mt-2 text-mist">{label}</p>
    </motion.div>
  );
}

export function Stats() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  return (
    <section ref={ref} aria-label="CloudPlay en cifras" className="mx-auto grid max-w-6xl gap-10 px-5 py-32 sm:grid-cols-2 lg:grid-cols-4">
      {STATS.map((s, i) => (
        <Stat key={s.label} {...s} i={i} progress={scrollYProgress} />
      ))}
    </section>
  );
}
