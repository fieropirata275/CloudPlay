"use client";

import { PerspectiveTextScroll } from "@/components/ui/skiper-ui/skiper28";

const TASKS = [
  "Arranca la consola",
  "carga la BIOS",
  "sube la resolución",
  "conecta el mando",
  "codifica el vídeo a 60 fps",
  "atraviesa el NAT",
  "guarda la partida",
  "reparte la carga entre nodos",
  "y avisa al siguiente de la cola.",
];

/** Skiper28: la lista de lo que hace el servidor se aleja en perspectiva mientras bajas. */
export function Backstage() {
  return (
    <section aria-labelledby="backstage-title" className="relative">
      <div className="mx-auto max-w-6xl px-5 pt-24">
        <h2 id="backstage-title" className="font-display text-[clamp(2rem,4.5vw,3.6rem)] font-extrabold tracking-[-0.02em]">
          Mientras juegas, CloudPlay:
        </h2>
      </div>
      <PerspectiveTextScroll
        height="220vh"
        travel={420}
        fadeClassName="to-ink"
        className="px-5 font-display text-[clamp(2.4rem,7vw,5.5rem)] font-extrabold leading-[1.05] text-glass"
      >
        {TASKS.map((t, i) => (
          <span key={t} className={i % 3 === 2 ? "text-led" : undefined}>
            {t}
            {i < TASKS.length - 1 ? ", " : ""}
          </span>
        ))}
      </PerspectiveTextScroll>
    </section>
  );
}
