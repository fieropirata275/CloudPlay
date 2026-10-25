"use client";

import { useScroll } from "framer-motion";
import { useRef } from "react";

import { CharacterV1 } from "@/components/ui/skiper-ui/skiper31";

/** Skiper31: las letras llegan dispersas y se ensamblan según haces scroll. */
function Line({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const chars = text.split("");
  const center = Math.floor(chars.length / 2);
  return (
    <div ref={ref} className="flex h-[60vh] items-center justify-center overflow-hidden">
      <p
        aria-label={text}
        className="w-full text-center font-display text-[clamp(2.2rem,8vw,7rem)] font-extrabold tracking-[-0.03em]"
        style={{ perspective: "500px" }}
      >
        {chars.map((c, i) => (
          <CharacterV1 key={i} char={c} index={i} centerIndex={center} scrollYProgress={scrollYProgress} className={className} />
        ))}
      </p>
    </div>
  );
}

export function ScrollStatement() {
  return (
    <section aria-label="Sin consola, sin descargas, sin cables" className="relative">
      <Line text="Sin consola." className="text-glass" />
      <Line text="Sin descargas." className="text-glass" />
      <Line text="Sin cables." className="text-led" />
    </section>
  );
}
