"use client";

import { AnimatePresence, motion, useSpring } from "framer-motion";
import { Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  VideoPlayer,
  VideoPlayerContent,
  VideoPlayerControlBar,
  VideoPlayerMuteButton,
  VideoPlayerPlayButton,
  VideoPlayerTimeRange,
} from "@/components/ui/skiper-ui/skiper67";

const SPOT = "/media/cloudplay-spot.mp4";
const POSTER = "/media/spot-poster.jpg";
const WORDS = ["Tus", "clásicos", "de", "PS2,", "GameCube", "y", "Wii", "en", "cualquier", "pantalla."];

/** Skiper67: el "Reproducir" sigue al cursor y abre el vídeo en un modal que se despliega con clip-path. */
function Showreel() {
  const [open, setOpen] = useState(false);
  const x = useSpring(0, { mass: 0.1 });
  const y = useSpring(0, { mass: 0.1 });
  const opacity = useSpring(0, { mass: 0.1 });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Ver el vídeo de CloudPlay"
        onClick={() => setOpen(true)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          opacity.set(1);
          x.set(e.clientX - r.left);
          y.set(e.clientY - r.top);
        }}
        onMouseLeave={() => opacity.set(0)}
        className="group relative block aspect-video w-full cursor-none overflow-hidden rounded-3xl border border-ink-3 bg-ink-2 shadow-[0_40px_120px_rgba(0,0,0,0.5)]"
      >
        <video autoPlay muted playsInline loop poster={POSTER} className="h-full w-full object-cover">
          <source src={SPOT} type="video/mp4" />
        </video>
        <motion.span
          style={{ x, y, opacity }}
          className="pointer-events-none absolute left-0 top-0 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-glass px-4 py-2 text-sm font-bold text-ink"
        >
          <Play className="size-4 fill-ink" /> Ver el spot
        </motion.span>
        <span className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-ink/80 px-3 py-1.5 text-sm md:hidden">
          <Play className="size-4 fill-glass" /> Ver el spot
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Vídeo de CloudPlay">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/90 backdrop-blur-lg"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ clipPath: "inset(43.5% 43.5% 33.5% 43.5%)", opacity: 0 }}
              animate={{ clipPath: "inset(0 0 0 0)", opacity: 1 }}
              exit={{ clipPath: "inset(43.5% 43.5% 33.5% 43.5%)", opacity: 0, transition: { type: "spring", stiffness: 100, damping: 20, opacity: { duration: 0.2, delay: 0.4 } } }}
              transition={{ type: "spring", stiffness: 100, damping: 20 }}
              className="relative aspect-video w-full max-w-6xl overflow-hidden rounded-2xl"
            >
              <VideoPlayer style={{ width: "100%", height: "100%" }}>
                <VideoPlayerContent src={SPOT} autoPlay slot="media" poster={POSTER} className="w-full object-cover" style={{ width: "100%", height: "100%" }} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar el vídeo"
                  className="absolute right-3 top-3 z-10 rounded-full bg-ink/70 p-2"
                >
                  <X className="size-5 text-glass" />
                </button>
                <VideoPlayerControlBar className="absolute bottom-0 left-1/2 flex w-full -translate-x-1/2 items-center justify-center px-5 mix-blend-exclusion">
                  <VideoPlayerPlayButton className="h-4 bg-transparent" />
                  <VideoPlayerTimeRange className="bg-transparent" />
                  <VideoPlayerMuteButton className="size-4 bg-transparent" />
                </VideoPlayerControlBar>
              </VideoPlayer>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

export function Hero() {
  return (
    <section id="inicio" className="relative mx-auto max-w-6xl px-5 pb-24 pt-36 md:pt-44">
      <h1 className="max-w-4xl font-display text-[clamp(2.4rem,6.2vw,5.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">
        {WORDS.map((w, i) => (
          <motion.span
            key={i}
            className="mr-[0.25em] inline-block"
            initial={{ opacity: 0, y: "0.6em", filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ type: "spring", stiffness: 220, damping: 24, delay: 0.1 + i * 0.05 }}
          >
            {w}
          </motion.span>
        ))}
      </h1>
      <motion.p
        className="mt-6 max-w-xl text-lg text-mist md:text-xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.5 }}
      >
        Emulación en la nube sobre tus propios servidores: tus clientes juegan en la tele, el móvil o el navegador
        sin consola, sin descargas y con la partida guardada.
      </motion.p>
      <motion.div
        className="mt-9 flex flex-wrap items-center gap-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.5 }}
      >
        <a href="#demo" className="rounded-full bg-led px-6 py-3 font-bold text-ink transition hover:brightness-110">
          Pedir una demo
        </a>
        <a href="#como-funciona" className="rounded-full px-6 py-3 font-bold text-glass ring-1 ring-ink-3 transition hover:bg-ink-2">
          Cómo funciona
        </a>
      </motion.div>
      <motion.div
        className="mt-16"
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1, type: "spring", stiffness: 120, damping: 20 }}
      >
        <Showreel />
      </motion.div>
    </section>
  );
}
