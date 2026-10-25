"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useLenis } from "lenis/react";
import { ArrowUp } from "lucide-react";
import { useRef } from "react";

import { Link000, Link001 } from "@/components/ui/skiper-ui/skiper40";
import { Mark } from "./Mark";
import { Magnetic } from "./MotionKit";

const NAME = "CloudPlay".split("");

export function Footer() {
  const lenis = useLenis();
  const ref = useRef<HTMLElement>(null);
  // El nombre gigante sube y se abre a medida que llegas al final
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const spread = useTransform(scrollYProgress, [0, 1], ["-0.12em", "-0.02em"]);
  const lift = useTransform(scrollYProgress, [0, 1], ["35%", "0%"]);

  return (
    <footer ref={ref} className="relative overflow-hidden border-t border-ink-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-10 text-sm text-mist">
        <span className="flex items-center gap-2 font-display font-extrabold text-glass">
          <Mark className="size-6" /> CloudPlay
        </span>
        <span>Solo juegos y BIOS de los que tengas copia legal.</span>
        {/* Skiper40: subrayado que entra por un lado y sale por el otro */}
        <Link000 href="#demo" className="hover:text-glass">
          Pedir una demo
        </Link000>
        <span className="flex items-center gap-1 md:ml-auto">
          Componentes animados de
          <Link001 href="https://skiper-ui.com" className="text-glass">
            Skiper UI
          </Link001>
        </span>
        <Magnetic strength={0.4}>
          <motion.button
            type="button"
            onClick={() => (lenis ? lenis.scrollTo(0, { duration: 1.6 }) : window.scrollTo({ top: 0, behavior: "smooth" }))}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.9 }}
            className="grid size-11 place-items-center rounded-full bg-ink-2 text-glass ring-1 ring-ink-3"
            aria-label="Volver arriba"
          >
            <ArrowUp className="size-5" />
          </motion.button>
        </Magnetic>
      </div>
      <motion.p
        aria-hidden="true"
        style={{ letterSpacing: spread, y: lift }}
        className="pointer-events-none select-none whitespace-nowrap px-2 text-center font-display text-[13.5vw] font-extrabold leading-[0.78] text-ink-2"
      >
        {NAME.map((ch, i) => (
          <motion.span
            key={i}
            className="inline-block"
            initial={{ y: "60%", opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ type: "spring", stiffness: 120, damping: 14, delay: i * 0.05 }}
            whileHover={{ y: "-8%", color: "#5B4BD6" }}
            style={{ pointerEvents: "auto" }}
          >
            {ch}
          </motion.span>
        ))}
      </motion.p>
    </footer>
  );
}
