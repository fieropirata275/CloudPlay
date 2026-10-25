"use client";

import { motion, useSpring } from "framer-motion";
import React, { useEffect } from "react";

import { cn } from "@/lib/utils";

const SPRING = {
  mass: 0.1, // avoid Controls inertia (how sluggish or responsive the object feels). Lower mass = snappier motion; higher mass = lethargic motion
  damping: 10, // its like the weight of the ball heavier the ball less it will bounce or harder the rubber band the more it will bounce
  stiffness: 131, // like rubber Band the more you strech the more speed it goes back to the original position
};

/** SpringMouseFollow. CloudPlay: sigue al puntero en toda la ventana (no dentro de una caja) y crece sobre
 * cualquier elemento con [data-cursor]. Solo se monta con ratón (pointer: fine). */
const SpringMouseFollow = ({ className }: { className?: string }) => {
  const xSpring = useSpring(0, SPRING);
  const ySpring = useSpring(0, SPRING);
  const opacitySpring = useSpring(0, SPRING);
  const scaleSpring = useSpring(0, SPRING);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      xSpring.set(e.clientX);
      ySpring.set(e.clientY);
      opacitySpring.set(1);
      const hot = (e.target as Element | null)?.closest?.("a, button, [data-cursor]");
      scaleSpring.set(hot ? 2.4 : 1);
    };
    const leave = () => {
      opacitySpring.set(0);
      scaleSpring.set(0);
    };
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [xSpring, ySpring, opacitySpring, scaleSpring]);

  return (
    <motion.div
      aria-hidden="true"
      style={{ x: xSpring, y: ySpring, opacity: opacitySpring, scale: scaleSpring }}
      className={cn(
        "pointer-events-none fixed left-0 top-0 z-[200] -ml-3 -mt-3 size-6 rounded-full bg-orange-500 mix-blend-difference",
        className,
      )}
    />
  );
};

export { SpringMouseFollow };

