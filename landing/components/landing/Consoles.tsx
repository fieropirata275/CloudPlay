"use client";

import { HoverExpand_001 } from "@/components/ui/skiper-ui/skiper52";

const CONSOLES = [
  { src: "/consoles/ps2.svg", alt: "PlayStation 2", code: "PlayStation 2 con PCSX2" },
  { src: "/consoles/gc.svg", alt: "GameCube", code: "GameCube con Dolphin" },
  { src: "/consoles/wii.svg", alt: "Wii", code: "Wii con Dolphin" },
];

/** Skiper52: la consola se despliega al pasar el ratón (o al tocarla). */
export function Consoles() {
  return (
    <section id="consolas" className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3.6rem)] font-extrabold tracking-[-0.02em]">Tres consolas, toda su biblioteca</h2>
        <p className="mt-4 text-lg text-mist">
          PS2 con PCSX2, GameCube y Wii con Dolphin, acelerados por la GPU de tus servidores. Copias las ROMs en la
          librería del nodo y los juegos aparecen solos en el catálogo.
        </p>
        <p className="mt-4 text-sm text-mist">Solo juegos y BIOS de los que tengas copia legal.</p>
      </div>
      {/* Skiper52 usa anchos fijos (~34rem): en móvil se sustituye por una rejilla para no desbordar */}
      <div className="hidden md:block">
        <HoverExpand_001 images={CONSOLES} className="px-0" />
      </div>
      <ul className="grid grid-cols-3 gap-2 md:hidden">
        {CONSOLES.map((c) => (
          <li key={c.alt}>
            <img src={c.src} alt={c.alt} className="aspect-[3/4] w-full rounded-2xl object-cover" />
            <p className="mt-2 text-xs text-mist">{c.alt}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
