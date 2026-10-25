"use client";

import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { useEffect, useState } from "react";

import { ProgressiveBlur } from "@/components/ui/skiper-ui/skiper41";
import { TextRoll } from "@/components/ui/skiper-ui/skiper58";
import { Mark } from "./Mark";
import { Magnetic } from "./MotionKit";

const LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#consolas", label: "Consolas" },
  { href: "#empresas", label: "Para empresas" },
];

export function Nav() {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  // Se esconde al bajar y vuelve en cuanto subes un poco
  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(y > 240 && y > prev + 2);
    if (y < prev - 2) setHidden(false);
  });

  // Sección visible → la pastilla se desliza hasta su enlace (layoutId)
  useEffect(() => {
    const els = LINKS.map((l) => document.querySelector(l.href)).filter(Boolean) as Element[];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive("#" + e.target.id);
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    const onTop = () => window.scrollY < 300 && setActive(null);
    window.addEventListener("scroll", onTop, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onTop);
    };
  }, []);

  return (
    <motion.header
      className="fixed inset-x-0 top-0 z-50"
      animate={{ y: hidden ? "-110%" : "0%" }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
    >
      {/* Skiper41: desenfoque progresivo bajo la barra */}
      <ProgressiveBlur position="top" height="120px" backgroundColor="#10123A" blurAmount="6px" />
      <nav className="relative mx-auto flex max-w-6xl items-center gap-8 px-5 py-4" aria-label="Principal">
        <a href="#inicio" className="group flex items-center gap-2 font-display text-lg font-extrabold">
          <motion.span whileHover={{ rotate: -12, scale: 1.12 }} transition={{ type: "spring", stiffness: 400, damping: 12 }} className="inline-flex">
            <Mark className="size-8" />
          </motion.span>
          CloudPlay
        </a>
        <ul className="ml-auto hidden items-center gap-2 text-[15px] text-mist md:flex">
          {LINKS.map((l) => (
            <li key={l.href} className="relative">
              {active === l.href && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-full bg-ink-3/80 ring-1 ring-plastic/40"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              {/* Skiper58: texto que rueda al pasar el ratón */}
              <a
                href={l.href}
                className={`relative block rounded-full px-4 py-1.5 hover:text-glass ${active === l.href ? "text-glass" : ""}`}
                aria-label={l.label}
                aria-current={active === l.href ? "location" : undefined}
              >
                {/* TextRoll anima letra a letra con inline-block: los espacios normales se colapsan */}
                <TextRoll>{l.label.replace(/ /g, " ")}</TextRoll>
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
    </motion.header>
  );
}
