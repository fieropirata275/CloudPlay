"use client";

import { useScroll } from "framer-motion";
import { useRef } from "react";

import { StickyCard_001 } from "@/components/ui/skiper-ui/skiper16";
import { LinePath } from "@/components/ui/skiper-ui/skiper19";
import { RevealText } from "./MotionKit";

const STEPS = [
  { n: 1, title: "Elige el juego", text: "La biblioteca aparece sola con los juegos de tus servidores. Favoritos y jugados hace poco, a un botón.", img: "/screens/tv_library.webp" },
  { n: 2, title: "Conecta la tele con un código", text: "La tele enseña un código y se aprueba desde el móvil. Nadie teclea contraseñas con el mando.", img: "/screens/tv_login.webp" },
  { n: 3, title: "La consola arranca en la nube", text: "Si todo está ocupado, una cola enseña la posición en vivo y entra sola en cuanto hay hueco.", img: "/screens/queue.webp" },
  { n: 4, title: "Juega en cualquier pantalla", text: "Vídeo a 60 fps por WebRTC, mandos físicos o táctiles, y la partida sigue si cambias de pantalla.", img: "/screens/phone_library.webp" },
];

/** Skiper16: los pasos se apilan como cartas a medida que haces scroll. */
export function HowItWorks() {
  const container = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: container, offset: ["start start", "end end"] });
  return (
    <section id="como-funciona" className="relative overflow-clip">
      {/* Skiper19: la "señal" se dibuja a medida que bajas por los pasos */}
      <LinePath
        scrollYProgress={scrollYProgress}
        from={0.05}
        stroke="#FFB000"
        strokeWidth={14}
        className="pointer-events-none absolute -right-[30%] top-24 z-0 h-auto w-[115%] opacity-40 md:-right-[12%] md:w-[80%]"
      />
      <div className="relative z-10 mx-auto max-w-6xl px-5 pt-24">
        <RevealText as="h2" text="Cómo funciona" className="font-display text-[clamp(2rem,4.5vw,3.6rem)] font-extrabold tracking-[-0.02em]" />
        <p className="mt-3 max-w-lg text-lg text-mist">Cuatro pasos desde el sofá hasta la partida.</p>
      </div>
      <div ref={container} className="relative z-10 pb-[40vh] pt-[10vh]">
        {STEPS.map((s, i) => (
          <StickyCard_001
            key={s.n}
            i={i}
            title={s.title}
            progress={scrollYProgress}
            range={[i * 0.25, 1]}
            targetScale={1 - (STEPS.length - i - 1) * 0.06}
            className="h-auto w-[min(92vw,960px)] rounded-[28px] border border-ink-3 bg-ink-2"
          >
            <div className="grid gap-0 md:grid-cols-[1fr_1.35fr]">
              <div className="flex flex-col justify-center p-7 md:p-10">
                <span className="font-display text-sm font-semibold text-led">Paso {s.n} de {STEPS.length}</span>
                <h3 className="mt-3 font-display text-2xl font-extrabold leading-tight md:text-3xl">{s.title}</h3>
                <p className="mt-4 text-mist">{s.text}</p>
              </div>
              <div className="relative h-56 overflow-hidden md:h-[340px]">
                <img src={s.img} alt="" className="absolute inset-0 h-full w-full object-cover object-top" loading="lazy" />
              </div>
            </div>
          </StickyCard_001>
        ))}
      </div>
    </section>
  );
}
