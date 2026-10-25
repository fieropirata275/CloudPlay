"use client";

import { motion, useMotionTemplate, useScroll, useTransform } from "framer-motion";
import React, { useRef } from "react";

import { cn } from "@/lib/utils";

/** Texto que avanza inclinado hacia el fondo mientras haces scroll.
 * CloudPlay: contenido, color y altura por props; sin ReactLenis propio (la página ya tiene uno en la raíz). */
const PerspectiveTextScroll = ({
  children,
  className,
  height = "300vh",
  fadeClassName = "to-[#f5f4f3]",
  travel = 487,
}: {
  children: React.ReactNode;
  className?: string;
  height?: string;
  fadeClassName?: string;
  travel?: number;
}) => {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: targetRef });

  const yMotionValue = useTransform(scrollYProgress, [0, 1], [travel, 0]);
  const transform = useMotionTemplate`rotateX(30deg) translateY(${yMotionValue}px) translateZ(10px)`;

  return (
    <div ref={targetRef} className="relative z-0 w-full" style={{ height }}>
      <div
        className="sticky top-0 mx-auto flex items-center justify-center overflow-hidden bg-transparent py-20"
        style={{ transformStyle: "preserve-3d", perspective: "200px" }}
      >
        <motion.div
          style={{ transformStyle: "preserve-3d", transform }}
          className={cn("relative w-full max-w-4xl text-center text-6xl font-bold tracking-tighter text-[#ff5800]", className)}
        >
          {children}
          <div className={cn("pointer-events-none absolute bottom-0 left-0 h-[60vh] w-full bg-gradient-to-b from-transparent", fadeClassName)} />
        </motion.div>
      </div>
    </div>
  );
};

export { PerspectiveTextScroll };

