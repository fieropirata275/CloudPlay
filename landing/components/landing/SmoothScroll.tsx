"use client";

import ReactLenis from "lenis/react";
import type { ReactNode } from "react";

/** Scroll suave de Lenis para toda la página (lo usan los efectos de scroll de Skiper UI). */
export function SmoothScroll({ children }: { children: ReactNode }) {
  return (
    <ReactLenis root options={{ lerp: 0.12, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}
