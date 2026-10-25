"use client";

import { VelocityMarquee } from "./MotionKit";

const DEVICES = ["Android", "Android TV", "Samsung Tizen", "LG webOS", "Chrome", "Edge", "Safari", "Firefox", "Mando Bluetooth", "Pantalla táctil"];

/** Cinta de pantallas compatibles: corre sola y acelera con la velocidad del scroll (Motion useVelocity). */
export function Devices() {
  return (
    <section aria-label="Pantallas compatibles" className="border-y border-ink-2 bg-ink-2/40 py-6">
      <VelocityMarquee items={DEVICES} className="font-display text-[clamp(1.6rem,4vw,3rem)] font-extrabold text-glass/90" />
    </section>
  );
}
