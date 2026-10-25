"use client";

import { AnimatePresence, motion, useScroll, useSpring, useTransform } from "framer-motion";
import { Play, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { useLoop } from "@/components/ui/skiper-ui/skiper62";
import { Magnetic } from "./MotionKit";

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
// three.js solo en el cliente y en un chunk aparte: no bloquea el primer pintado
const HeroScene = dynamic(() => import("./HeroScene").then((m) => m.HeroScene), { ssr: false });
const SHAPE_LABELS = ["Tu nube", "PlayStation 2", "GameCube", "Wii"];
const SCREENS = ["la tele del salón", "el móvil", "el navegador", "la Android TV", "la tele del hotel"];

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

/** Skiper62 (useLoop): la pantalla de destino va cambiando sola. */
function RotatingScreen() {
  const { key } = useLoop(1900);
  const word = SCREENS[key % SCREENS.length];
  return (
    <span className="relative inline-flex overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={key}
          initial={{ opacity: 0, y: "100%", filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: "-100%", filter: "blur(4px)" }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="whitespace-nowrap font-bold text-led"
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const [shape, setShape] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // La escena 3D se aleja y se apaga al bajar
  const sceneOpacity = useTransform(scrollYProgress, [0, 0.55], [1, 0]);
  const sceneY = useTransform(scrollYProgress, [0, 1], [0, 220]);
  const sceneScale = useTransform(scrollYProgress, [0, 0.6], [1, 0.82]);

  return (
    <section ref={ref} id="inicio" className="relative mx-auto max-w-6xl px-5 pb-24 pt-36 md:pt-44">
      <motion.div
        style={{ opacity: sceneOpacity, y: sceneY, scale: sceneScale }}
        className="pointer-events-none absolute -right-24 top-10 z-0 h-[520px] w-[115%] opacity-60 sm:right-[-8%] md:top-6 md:h-[700px] md:w-[62%]"
      >
        <HeroScene onShape={setShape} className="h-full w-full max-md:opacity-50" />
        <div className="absolute bottom-24 right-[18%] hidden items-center gap-2 rounded-full border border-ink-3 bg-ink/70 px-3 py-1.5 text-xs text-mist backdrop-blur md:flex">
          <span className="size-1.5 animate-pulse rounded-full bg-led" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={shape}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {SHAPE_LABELS[shape]}
            </motion.span>
          </AnimatePresence>
        </div>
      </motion.div>

      <h1 className="relative z-10 max-w-4xl font-display text-[clamp(2.4rem,6.2vw,5.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">
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
        className="relative z-10 mt-6 max-w-xl text-lg text-mist md:text-xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.5 }}
      >
        Emulación en la nube sobre tus propios servidores. Tus clientes juegan en <RotatingScreen /> sin consola, sin
        descargas y con la partida guardada.
      </motion.p>
      <motion.div
        className="relative z-10 mt-9 flex flex-wrap items-center gap-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.5 }}
      >
        <Magnetic>
          <a href="#demo" className="block rounded-full bg-led px-6 py-3 font-bold text-ink transition hover:brightness-110">
            Pedir una demo
          </a>
        </Magnetic>
        <Magnetic strength={0.25}>
          <a href="#como-funciona" className="block rounded-full bg-ink/60 px-6 py-3 font-bold text-glass ring-1 ring-ink-3 backdrop-blur transition hover:bg-ink-2">
            Cómo funciona
          </a>
        </Magnetic>
      </motion.div>
      <motion.div
        className="relative z-10 mt-16"
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1, type: "spring", stiffness: 120, damping: 20 }}
      >
        <Showreel />
      </motion.div>
    </section>
  );
}
