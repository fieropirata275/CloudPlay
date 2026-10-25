"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, LoaderCircle } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { RevealText } from "./MotionKit";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
type Status = { kind: "idle" | "sending" | "ok" | "error"; text?: string };

const field = "w-full rounded-xl border border-ink-3 bg-ink px-4 py-3 text-glass placeholder:text-mist/60 focus:border-led focus:outline-none";

/** Anillo de foco compartido: salta de un campo a otro con layoutId. */
function Slot({ name, focus, children }: { name: string; focus: string | null; children: ReactNode }) {
  return (
    <span className="relative mt-2 block">
      {children}
      {focus === name && (
        <motion.span
          layoutId="field-focus"
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[3px] rounded-[14px] ring-2 ring-led shadow-[0_0_30px_rgba(255,176,0,0.25)]"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      )}
    </span>
  );
}

const COLORS = ["#FFB000", "#5B4BD6", "#38C5F2", "#E8F1FF", "#8B6DFF"];

/** Confeti al enviar: 36 piezas con trayectoria y giro aleatorios. */
function Confetti() {
  const pieces = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2 + Math.random() * 0.4;
    const d = 120 + Math.random() * 220;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d - 80, r: Math.random() * 720 - 360, c: COLORS[i % COLORS.length], s: 6 + Math.random() * 8, round: i % 3 === 0 };
  });
  return (
    <span aria-hidden="true" className="pointer-events-none absolute left-8 top-8">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute block"
          style={{ width: p.s, height: p.round ? p.s : p.s * 0.45, background: p.c, borderRadius: p.round ? 999 : 2 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 260], opacity: [1, 1, 0], rotate: p.r, scale: 1 }}
          transition={{ duration: 1.6, ease: [0.2, 0.7, 0.4, 1], times: [0, 0.45, 1] }}
        />
      ))}
    </span>
  );
}

export function DemoForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focus, setFocus] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    setStatus({ kind: "sending" });
    try {
      const r = await fetch(`${API}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (r.ok) {
        setStatus({ kind: "ok" });
        return;
      }
      const body = await r.json().catch(() => ({}));
      const detail = typeof body.detail === "string" ? body.detail : "Revisa los campos marcados y vuelve a enviarlo.";
      setStatus({ kind: "error", text: detail });
    } catch {
      setStatus({ kind: "error", text: "No hemos podido enviarlo. Comprueba la conexión y vuelve a intentarlo." });
    }
  }

  return (
    <section id="demo" className="mx-auto max-w-6xl px-5 py-24">
      <div className="grid gap-12 rounded-[32px] border border-ink-3 bg-ink-2 p-7 md:grid-cols-[1fr_1.3fr] md:p-12">
        <div>
          <RevealText as="h2" text="Pide una demo" className="font-display text-[clamp(2rem,4vw,3.2rem)] font-extrabold tracking-[-0.02em]" />
          <p className="mt-4 text-lg text-mist">Te enseñamos CloudPlay funcionando y vemos cuántos nodos necesitas para tus jugadores.</p>
        </div>
        <AnimatePresence mode="wait">
          {status.kind === "ok" ? (
            <motion.div
              key="ok"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="relative flex flex-col justify-center"
              role="status"
            >
              <Confetti />
              <motion.span
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 14 }}
                className="mb-5 grid size-16 place-items-center rounded-full bg-led text-ink"
              >
                <Check className="size-8" strokeWidth={3} />
              </motion.span>
              <p className="font-display text-3xl font-extrabold text-led">Solicitud enviada</p>
              <p className="mt-3 text-mist">Te escribimos en menos de dos días laborables al email que nos has dejado.</p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={submit}
              onFocus={(e) => setFocus((e.target as unknown as HTMLInputElement).name || null)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(null);
              }}
              exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
              className="grid gap-5 sm:grid-cols-2"
            >
              <label className="text-sm text-mist">
                Nombre
                <Slot name="name" focus={focus}>
                  <input name="name" required minLength={2} maxLength={120} autoComplete="name" className={field} />
                </Slot>
              </label>
              <label className="text-sm text-mist">
                Email de trabajo
                <Slot name="email" focus={focus}>
                  <input name="email" type="email" required maxLength={255} autoComplete="email" className={field} />
                </Slot>
              </label>
              <label className="text-sm text-mist">
                Empresa
                <Slot name="company" focus={focus}>
                  <input name="company" maxLength={160} autoComplete="organization" className={field} />
                </Slot>
              </label>
              <label className="text-sm text-mist">
                Jugadores a la vez
                <Slot name="players" focus={focus}>
                <select name="players" defaultValue="" className={field}>
                  <option value="">Aún no lo sé</option>
                  <option>1-10</option>
                  <option>11-50</option>
                  <option>51-200</option>
                  <option>Más de 200</option>
                </select>
                </Slot>
              </label>
              <label className="text-sm text-mist sm:col-span-2">
                Qué quieres montar
                <Slot name="message" focus={focus}>
                  <textarea name="message" rows={4} maxLength={2000} className={field} placeholder="Por ejemplo: 20 teles en un hotel y acceso desde el móvil" />
                </Slot>
              </label>
              {/* honeypot: invisible para personas */}
              <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                <motion.button
                  layout
                  type="submit"
                  disabled={status.kind === "sending"}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  style={{ borderRadius: 999 }}
                  className="flex h-12 items-center justify-center overflow-hidden bg-led font-bold text-ink hover:brightness-110 disabled:cursor-wait"
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {status.kind === "sending" ? (
                      <motion.span key="s" className="grid size-12 place-items-center" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }}>
                        <LoaderCircle className="size-5 animate-spin" aria-label="Enviando" />
                      </motion.span>
                    ) : (
                      <motion.span key="t" className="px-7" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                        Enviar solicitud
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
                <AnimatePresence>
                  {status.kind === "error" && (
                    <motion.p
                      role="alert"
                      className="text-[#FF6B7A]"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.45 }}
                    >
                      {status.text}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
