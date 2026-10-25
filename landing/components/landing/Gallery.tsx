"use client";

import { ParallaxGallery } from "@/components/ui/skiper-ui/skiper30";
import { SkewOnScroll } from "./MotionKit";

const IMAGES = [
  { src: "/screens/tv_library.webp", alt: "Biblioteca de juegos en la tele" },
  { src: "/consoles/ps2.svg", alt: "Carátula genérica de PlayStation 2" },
  { src: "/screens/phone_library.webp", alt: "Biblioteca en el móvil" },
  { src: "/screens/queue.webp", alt: "Cola de espera con la posición en vivo" },
  { src: "/consoles/gc.svg", alt: "Carátula genérica de GameCube" },
  { src: "/screens/tv_login.webp", alt: "Código para conectar la tele" },
  { src: "/screens/admin.webp", alt: "Panel de operaciones" },
  { src: "/consoles/wii.svg", alt: "Carátula genérica de Wii" },
  { src: "/screens/phone_link.webp", alt: "Aprobar la tele desde el móvil" },
];

/** Skiper30: cuatro columnas de capturas a distinta velocidad. */
export function Gallery() {
  return (
    <section aria-label="Galería de pantallas" className="relative">
      <SkewOnScroll max={4}>
        <ParallaxGallery images={IMAGES} className="bg-ink" imageClassName="rounded-[1.4vw] border border-ink-3 bg-ink-2" />
      </SkewOnScroll>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
    </section>
  );
}
