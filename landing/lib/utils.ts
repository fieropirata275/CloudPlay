import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases condicionales y resuelve conflictos de Tailwind (lo que esperan shadcn y Skiper UI). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
