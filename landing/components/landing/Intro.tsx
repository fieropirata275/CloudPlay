"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { markIntroDone } from "./intro-store";

const CLOUD = "M52,140 C30,140 18,124 22,106 C25,92 38,84 52,86 C56,62 76,48 100,50 C124,52 140,70 142,90 C160,88 178,102 176,120 C174,134 162,140 150,140 Z";
const NAME = "CloudPlay".split("");

/**
 * Arranque tipo consola: la nube se dibuja, se enciende el LED y la cortina sube.
 * Solo la primera vez por sesión y nunca con "reducir movimiento".
 * Si el JS no carga, una animación CSS (.intro-failsafe) la quita a los 3 s.
 */
export function Intro() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("cp-intro") === "1";
      sessionStorage.setItem("cp-intro", "1");
    } catch {}
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduced) {
      setShow(false);
      markIntroDone();
      return;
    }
    document.documentElement.style.overflow = "hidden";
    const t = setTimeout(() => {
      setShow(false);
      markIntroDone();
      document.documentElement.style.overflow = "";
    }, 1900);
    return () => {
      clearTimeout(t);
      document.documentElement.style.overflow = "";
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="intro"
          aria-hidden="true"
          className="intro-failsafe fixed inset-0 z-[300] flex flex-col items-center justify-center gap-6 bg-ink"
          exit={{ clipPath: "inset(0 0 100% 0)" }}
          initial={{ clipPath: "inset(0 0 0% 0)" }}
          transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1] }}
        >
          <svg viewBox="0 0 200 200" className="size-28">
            <defs>
              <linearGradient id="intro-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#9A8BFF" />
                <stop offset="1" stopColor="#5B4BD6" />
              </linearGradient>
            </defs>
            <motion.path
              d={CLOUD}
              stroke="#9A8BFF"
              strokeWidth={5}
              strokeLinecap="round"
              initial={{ pathLength: 0, fill: "rgba(91,75,214,0)" }}
              animate={{ pathLength: 1, fill: "url(#intro-g)" }}
              transition={{ pathLength: { duration: 0.9, ease: "easeInOut" }, fill: { delay: 0.8, duration: 0.4 } }}
            />
            <motion.circle
              cx="100"
              cy="166"
              r="7"
              fill="#FFB000"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 1, 0.4, 1], scale: 1 }}
              transition={{ delay: 1, duration: 0.6 }}
              style={{ filter: "drop-shadow(0 0 10px #FFB000)" }}
            />
          </svg>
          <div className="flex overflow-hidden font-display text-3xl font-extrabold text-glass">
            {NAME.map((ch, i) => (
              <motion.span
                key={i}
                initial={{ y: "110%" }}
                animate={{ y: 0 }}
                transition={{ delay: 0.5 + i * 0.04, type: "spring", stiffness: 260, damping: 22 }}
              >
                {ch}
              </motion.span>
            ))}
          </div>
          <div className="h-[3px] w-40 overflow-hidden rounded-full bg-ink-3">
            <motion.div
              className="h-full origin-left bg-gradient-to-r from-plastic via-wii to-led"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1.6, ease: [0.65, 0, 0.35, 1] }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
