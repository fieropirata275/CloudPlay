"use client";

import { motion } from "framer-motion";

import { RevealText, SpotlightCard, TiltCard } from "./MotionKit";

const POINTS = [
  { title: "Tus servidores, tus datos", text: "Despliegas el control plane y los nodos GPU en tu infraestructura con Docker. Nada sale de tu red salvo el vídeo hacia el jugador." },
  { title: "Panel de operaciones en vivo", text: "Nodos con carga y último latido, partidas en curso y en cola, fallos de las últimas 24 horas y cierre forzado de partidas." },
  { title: "Escala por nodos", text: "Cada máquina con GPU NVIDIA, Intel o AMD suma huecos de juego. El planificador reparte la carga y la cola absorbe los picos." },
  { title: "Entra con un código", text: "Hoteles, bares o salas: la tele se empareja desde el móvil del cliente en segundos, sin cuentas compartidas en la pantalla." },
];

export function Business() {
  return (
    <section id="empresas" className="mx-auto max-w-6xl px-5 py-24">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:items-center">
        <div>
          <RevealText as="h2" text="Para tu negocio" className="font-display text-[clamp(2rem,4.5vw,3.6rem)] font-extrabold tracking-[-0.02em]" />
          <p className="mt-4 text-lg text-mist">CloudPlay se instala en tu infraestructura y se opera desde un panel pensado para un NOC.</p>
        </div>
        <motion.div
          initial={{ opacity: 0, x: 60, rotate: 1.5 }}
          whileInView={{ opacity: 1, x: 0, rotate: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
        >
          <TiltCard>
            <div className="overflow-hidden rounded-2xl border border-ink-3 bg-[#05061a] pt-9 shadow-[0_40px_120px_rgba(0,0,0,0.5)]">
              <img src="/screens/admin.webp" alt="Panel de operaciones de CloudPlay" className="w-full" loading="lazy" />
            </div>
          </TiltCard>
        </motion.div>
      </div>
      <ul className="mt-16 grid gap-5 md:grid-cols-2">
        {POINTS.map((p, i) => (
          <motion.li
            key={p.title}
            initial={{ opacity: 0, y: 32, filter: "blur(6px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ type: "spring", stiffness: 140, damping: 20, delay: (i % 2) * 0.1 }}
          >
            <SpotlightCard className="h-full">
              <div className="p-7">
                <h3 className="font-display text-xl font-extrabold">{p.title}</h3>
                <p className="mt-2 text-mist">{p.text}</p>
              </div>
            </SpotlightCard>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
