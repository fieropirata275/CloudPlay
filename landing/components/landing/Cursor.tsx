"use client";

import { useEffect, useState } from "react";

import { SpringMouseFollow } from "@/components/ui/skiper-ui/skiper61";

/** Skiper61: punto que sigue al ratón con muelle. Solo con ratón y sin "reducir movimiento". */
export function Cursor() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");
    const set = () => setOn(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  return on ? <SpringMouseFollow className="bg-led" /> : null;
}
