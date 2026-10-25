"use client";

import { ProgressiveBlur } from "@/components/ui/skiper-ui/skiper41";
import { TextRoll } from "@/components/ui/skiper-ui/skiper58";
import { Mark } from "./Mark";
import { Magnetic, ScrollProgress } from "./MotionKit";

const LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#consolas", label: "Consolas" },
  { href: "#empresas", label: "Para empresas" },
];

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <ScrollProgress />
      {/* Skiper41: desenfoque progresivo bajo la barra */}
      <ProgressiveBlur position="top" height="120px" backgroundColor="#10123A" blurAmount="6px" />
      <nav className="relative mx-auto flex max-w-6xl items-center gap-8 px-5 py-4" aria-label="Principal">
        <a href="#inicio" className="flex items-center gap-2 font-display text-lg font-extrabold">
          <Mark className="size-8" />
          CloudPlay
        </a>
        <ul className="ml-auto hidden items-center gap-7 text-[15px] text-mist md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              {/* Skiper58: texto que rueda al pasar el ratón */}
              <a href={l.href} className="block hover:text-glass" aria-label={l.label}>
                {/* TextRoll anima letra a letra con inline-block: los espacios normales se colapsan */}
                <TextRoll>{l.label.replace(/ /g, "\u00A0")}</TextRoll>
              </a>
            </li>
          ))}
        </ul>
        <Magnetic className="ml-auto md:ml-0" strength={0.3}>
          <a href="#demo" className="block rounded-full bg-glass px-4 py-2 text-sm font-bold text-ink transition hover:bg-white">
            Pedir una demo
          </a>
        </Magnetic>
      </nav>
    </header>
  );
}
