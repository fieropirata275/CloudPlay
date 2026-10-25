"use client";

import NumberFlow from "@number-flow/react";
import { useInView } from "react-intersection-observer";

const STATS = [
  { value: 60, suffix: " fps", label: "de vídeo H.264 por WebRTC" },
  { value: 4, suffix: "", label: "mandos a la vez por partida" },
  { value: 3, suffix: "", label: "consolas: PS2, GameCube y Wii" },
  { value: 5, suffix: "", label: "pantallas: Android, Android TV, Samsung, LG y web" },
];

/** Inspirado en Skiper37: los números cuentan hasta su valor cuando entran en pantalla (NumberFlow). */
function Stat({ value, suffix, label }: (typeof STATS)[number]) {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.6 });
  return (
    <div ref={ref} className="border-t border-ink-3 pt-6">
      <p className="font-display text-6xl font-extrabold tracking-[-0.03em] text-glass">
        <NumberFlow value={inView ? value : 0} suffix={suffix} transformTiming={{ duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" }} />
      </p>
      <p className="mt-2 text-mist">{label}</p>
    </div>
  );
}

export function Stats() {
  return (
    <section aria-label="CloudPlay en cifras" className="mx-auto grid max-w-6xl gap-10 px-5 py-24 sm:grid-cols-2 lg:grid-cols-4">
      {STATS.map((s) => (
        <Stat key={s.label} {...s} />
      ))}
    </section>
  );
}
