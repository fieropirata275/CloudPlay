import { Link000, Link001 } from "@/components/ui/skiper-ui/skiper40";
import { Mark } from "./Mark";

export function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 border-t border-ink-2 px-5 py-10 text-sm text-mist">
      <span className="flex items-center gap-2 font-display font-extrabold text-glass">
        <Mark className="size-6" /> CloudPlay
      </span>
      <span>Solo juegos y BIOS de los que tengas copia legal.</span>
      {/* Skiper40: subrayado que entra por un lado y sale por el otro */}
      <Link000 href="#demo" className="hover:text-glass">
        Pedir una demo
      </Link000>
      <span className="flex items-center gap-1 md:ml-auto">
        Componentes animados de
        <Link001 href="https://skiper-ui.com" className="text-glass">
          Skiper UI
        </Link001>
      </span>
    </footer>
  );
}
