"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState, type FormEvent } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
type Status = { kind: "idle" | "sending" | "ok" | "error"; text?: string };

const field = "mt-2 w-full rounded-xl border border-ink-3 bg-ink px-4 py-3 text-glass placeholder:text-mist/60 focus:border-led focus:outline-none";

export function DemoForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

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
          <h2 className="font-display text-[clamp(2rem,4vw,3.2rem)] font-extrabold tracking-[-0.02em]">Pide una demo</h2>
          <p className="mt-4 text-lg text-mist">Te enseñamos CloudPlay funcionando y vemos cuántos nodos necesitas para tus jugadores.</p>
        </div>
        <AnimatePresence mode="wait">
          {status.kind === "ok" ? (
            <motion.div
              key="ok"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="flex flex-col justify-center"
              role="status"
            >
              <p className="font-display text-3xl font-extrabold text-led">Solicitud enviada</p>
              <p className="mt-3 text-mist">Te escribimos en menos de dos días laborables al email que nos has dejado.</p>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={submit} exit={{ opacity: 0, y: -10 }} className="grid gap-5 sm:grid-cols-2">
              <label className="text-sm text-mist">
                Nombre
                <input name="name" required minLength={2} maxLength={120} autoComplete="name" className={field} />
              </label>
              <label className="text-sm text-mist">
                Email de trabajo
                <input name="email" type="email" required maxLength={255} autoComplete="email" className={field} />
              </label>
              <label className="text-sm text-mist">
                Empresa
                <input name="company" maxLength={160} autoComplete="organization" className={field} />
              </label>
              <label className="text-sm text-mist">
                Jugadores a la vez
                <select name="players" defaultValue="" className={field}>
                  <option value="">Aún no lo sé</option>
                  <option>1-10</option>
                  <option>11-50</option>
                  <option>51-200</option>
                  <option>Más de 200</option>
                </select>
              </label>
              <label className="text-sm text-mist sm:col-span-2">
                Qué quieres montar
                <textarea name="message" rows={4} maxLength={2000} className={field} placeholder="Por ejemplo: 20 teles en un hotel y acceso desde el móvil" />
              </label>
              {/* honeypot: invisible para personas */}
              <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                <button
                  type="submit"
                  disabled={status.kind === "sending"}
                  className="rounded-full bg-led px-7 py-3 font-bold text-ink transition hover:brightness-110 disabled:opacity-60"
                >
                  {status.kind === "sending" ? "Enviando…" : "Enviar solicitud"}
                </button>
                {status.kind === "error" && (
                  <p role="alert" className="text-[#FF6B7A]">
                    {status.text}
                  </p>
                )}
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
