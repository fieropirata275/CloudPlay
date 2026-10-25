"use client";

import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  wrap,
} from "framer-motion";
import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Barra fina arriba del todo que se llena con el scroll de la página. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 220, damping: 32, restDelta: 0.001 });
  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-gradient-to-r from-plastic via-wii to-led"
    />
  );
}

/** El hijo se deja "atraer" por el puntero y vuelve con un muelle al salir. */
export function Magnetic({ children, strength = 0.35, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const x = useSpring(0, { stiffness: 260, damping: 18, mass: 0.4 });
  const y = useSpring(0, { stiffness: 260, damping: 18, mass: 0.4 });
  return (
    <motion.div
      ref={ref}
      style={{ x, y }}
      className={cn("inline-block", className)}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== "mouse" || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** Cinta infinita que acelera (y cambia de sentido) con la velocidad del scroll. */
export function VelocityMarquee({ items, baseVelocity = -2, className }: { items: string[]; baseVelocity?: number; className?: string }) {
  const reduced = useReducedMotion();
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const smooth = useSpring(velocity, { damping: 50, stiffness: 400 });
  const factor = useTransform(smooth, [0, 1000], [0, 5], { clamp: false });
  const x = useTransform(baseX, (v) => `${wrap(-25, -50, v)}%`);
  const dir = useRef(1);

  useAnimationFrame((_, delta) => {
    if (reduced) return;
    let move = dir.current * baseVelocity * (delta / 1000);
    const f = factor.get();
    if (f < 0) dir.current = -1;
    else if (f > 0) dir.current = 1;
    move += dir.current * move * f;
    baseX.set(baseX.get() + move);
  });

  const row = (
    <>
      {items.map((t) => (
        <span key={t} className="flex items-center gap-8 pr-8">
          {t}
          <span aria-hidden="true" className="size-2.5 rotate-45 bg-led" />
        </span>
      ))}
    </>
  );

  return (
    <div className={cn("flex overflow-hidden whitespace-nowrap", className)}>
      <span className="sr-only">{items.join(", ")}</span>
      <motion.div aria-hidden="true" style={{ x }} className="flex flex-nowrap">
        {row}
        {row}
        {row}
        {row}
      </motion.div>
    </div>
  );
}

/** Tarjeta que se inclina en 3D siguiendo al puntero, con un brillo que acompaña. */
export function TiltCard({ children, className, max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 180, damping: 20 });
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 180, damping: 20 });
  const glow = useTransform([px, py], ([a, b]) => `radial-gradient(600px circle at ${(a as number) * 100}% ${(b as number) * 100}%, rgba(255,176,0,0.16), transparent 45%)`);

  return (
    <div style={{ perspective: 1200 }} className={className}>
      <motion.div
        ref={ref}
        data-cursor
        style={reduced ? undefined : { rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        onPointerMove={(e) => {
          if (!ref.current || e.pointerType !== "mouse") return;
          const r = ref.current.getBoundingClientRect();
          px.set((e.clientX - r.left) / r.width);
          py.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => {
          px.set(0.5);
          py.set(0.5);
        }}
        className="relative"
      >
        {children}
        <motion.div aria-hidden="true" style={{ background: glow }} className="pointer-events-none absolute inset-0 rounded-[inherit]" />
      </motion.div>
    </div>
  );
}

/** Titular que entra palabra a palabra desde detrás de una máscara al aparecer en pantalla.
 * El disparo lo observa el contenedor: las palabras empiezan recortadas y un observer sobre ellas nunca vería nada. */
export function RevealText({ text, className, delay = 0, as: Tag = "span" }: { text: string; className?: string; delay?: number; as?: "span" | "h2" | "h3" | "p" }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const words = text.split(" ");
  const show = reduced || inView;
  return (
    <Tag ref={ref as never} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true" className="inline-block overflow-hidden pb-[0.12em] align-top">
          <motion.span
            className="inline-block"
            initial={reduced ? false : { y: "110%", rotate: 6 }}
            animate={show ? { y: 0, rotate: 0 } : undefined}
            transition={{ type: "spring", stiffness: 160, damping: 20, delay: delay + i * 0.06 }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </Tag>
  );
}

/** Borde y fondo que se iluminan donde está el puntero. */
export function SpotlightCard({ children, className }: { children: ReactNode; className?: string }) {
  const mx = useMotionValue(-400);
  const my = useMotionValue(-400);
  const bg = useMotionTemplate`radial-gradient(360px circle at ${mx}px ${my}px, rgba(255,176,0,0.55), transparent 60%)`;
  const inner = useMotionTemplate`radial-gradient(420px circle at ${mx}px ${my}px, rgba(91,75,214,0.18), transparent 60%)`;
  return (
    <motion.div
      data-cursor
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(e.clientX - r.left);
        my.set(e.clientY - r.top);
      }}
      onPointerLeave={() => {
        mx.set(-400);
        my.set(-400);
      }}
      style={{ background: bg }}
      className={cn("group relative rounded-3xl bg-ink-3 p-px", className)}
    >
      <div className="relative h-full rounded-[calc(1.5rem-1px)] bg-ink-2">
        <motion.div aria-hidden="true" style={{ background: inner }} className="pointer-events-none absolute inset-0 rounded-[inherit]" />
        <div className="relative">{children}</div>
      </div>
    </motion.div>
  );
}

/** Inclina el contenido según la velocidad del scroll: al frenar vuelve recto con un muelle. */
export function SkewOnScroll({ children, className, max = 5 }: { children: ReactNode; className?: string; max?: number }) {
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  const v = useVelocity(scrollY);
  const smooth = useSpring(v, { stiffness: 300, damping: 50 });
  const skewY = useTransform(smooth, [-3000, 0, 3000], [max, 0, -max], { clamp: true });
  return (
    <motion.div style={reduced ? undefined : { skewY }} className={className}>
      {children}
    </motion.div>
  );
}
