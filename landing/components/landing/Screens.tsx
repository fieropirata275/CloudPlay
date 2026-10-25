"use client";

import { Carousel_001 } from "@/components/ui/skiper-ui/skiper47";
import { RevealText } from "./MotionKit";

const SHOTS = [
  { src: "/screens/tv_library.webp", alt: "Biblioteca en la tele con favoritos y jugados hace poco" },
  { src: "/screens/tv_login.webp", alt: "Código para conectar la tele" },
  { src: "/screens/queue.webp", alt: "Pantalla de cola con la posición en vivo" },
  { src: "/screens/admin.webp", alt: "Panel de operaciones con nodos y partidas" },
  { src: "/screens/tv_library.webp", alt: "Biblioteca en la tele" },
  { src: "/screens/tv_login.webp", alt: "Código para conectar la tele" },
];

/** Skiper47: carrusel en perspectiva con capturas reales del producto. */
export function Screens() {
  return (
    <section aria-label="Capturas del producto" className="overflow-hidden py-24">
      <div className="mx-auto max-w-6xl px-5">
        <RevealText as="h2" text="Así se ve" className="font-display text-[clamp(2rem,4.5vw,3.6rem)] font-extrabold tracking-[-0.02em]" />
        <p className="mt-3 max-w-lg text-lg text-mist">Capturas de la app funcionando, no maquetas.</p>
      </div>
      <div className="mt-12 flex justify-center">
        <Carousel_001 images={SHOTS} className="w-full max-w-5xl" showPagination loop autoplay />
      </div>
    </section>
  );
}
