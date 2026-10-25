import { Mark } from "./Mark";

export function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 border-t border-ink-2 px-5 py-10 text-sm text-mist">
      <span className="flex items-center gap-2 font-display font-extrabold text-glass">
        <Mark className="size-6" /> CloudPlay
      </span>
      <span>Solo juegos y BIOS de los que tengas copia legal.</span>
      <span className="md:ml-auto">
        Componentes animados de{" "}
        <a href="https://skiper-ui.com" className="underline decoration-ink-3 underline-offset-4 hover:text-glass" target="_blank" rel="noopener noreferrer">
          Skiper UI
        </a>
      </span>
    </footer>
  );
}
