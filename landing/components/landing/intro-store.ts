import { useSyncExternalStore } from "react";

/** Estado compartido "la intro ha terminado": el hero espera a que se levante la cortina. */
let done = false;
const subs = new Set<() => void>();

export function markIntroDone() {
  if (done) return;
  done = true;
  subs.forEach((f) => f());
}

export function useIntroDone() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => done,
    () => false,
  );
}
