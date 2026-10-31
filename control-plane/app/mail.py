"""Correo de CloudPlay: avisos a jugadores y al NOC por Resend (API) o por cualquier SMTP.

    Proveedor y remitente: variables CP_MAIL_* del .env (las pone `cloudplay mail setup` en el máster, que además
    da de alta el dominio en Resend y escribe SPF, DKIM y DMARC en Cloudflare).
    Qué correos salen y a quién avisar: ajustes en la base de datos, se cambian desde el panel (/#/admin).

Cada envío queda en mail_log (sin el cuerpo). Un correo que falla nunca rompe la petición que lo provocó.
"""
import asyncio
import html
import json
import logging
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, parseaddr

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import MailLog, Setting, User, now

log = logging.getLogger("cloudplay.mail")

# Tipos de correo: (asunto, para quién, activo por defecto)
KINDS = {
    "welcome": ("Bienvenido a CloudPlay", "jugador", True),
    "reset": ("Recupera tu contraseña de CloudPlay", "jugador", True),
    "password_changed": ("Tu contraseña de CloudPlay ha cambiado", "jugador", True),
    "lead_ack": ("Hemos recibido tu solicitud de demo", "jugador", True),
    "lead": ("Nueva solicitud de demo", "administradores", True),
    "node_down": ("Nodo caído", "administradores", True),
    "test": ("Correo de prueba de CloudPlay", "quien lo pida", True),
}
LABELS = {
    "welcome": "Bienvenida al crear la cuenta",
    "reset": "Recuperar la contraseña",
    "password_changed": "Aviso de contraseña cambiada",
    "lead_ack": "Confirmación al que pide una demo",
    "lead": "Nueva solicitud de demo (al NOC)",
    "node_down": "Nodo gaming caído (al NOC)",
    "test": "Prueba",
}
ALWAYS = {"reset", "test"}  # sin ellos no se puede recuperar la cuenta ni comprobar el correo

_tasks: set[asyncio.Task] = set()


def configured() -> bool:
    p = settings.mail_provider
    if p == "resend":
        return bool(settings.resend_api_key and settings.mail_from)
    if p == "smtp":
        return bool(settings.smtp_host and settings.mail_from)
    return False


# ------------------------------------------------------------------ ajustes del panel
DEFAULTS = {"types": {k: v[2] for k, v in KINDS.items()}, "notify": [], "sender_name": "CloudPlay", "reply_to": ""}


async def get_prefs(db) -> dict:
    row = await db.get(Setting, "mail")
    prefs = json.loads(json.dumps(DEFAULTS))
    if row is not None:
        try:
            saved = json.loads(row.value)
        except ValueError:
            saved = {}
        prefs["types"].update({k: bool(v) for k, v in (saved.get("types") or {}).items() if k in KINDS})
        for k in ("notify", "sender_name", "reply_to"):
            if k in saved:
                prefs[k] = saved[k]
    return prefs


async def save_prefs(db, prefs: dict) -> dict:
    cur = await get_prefs(db)
    if "types" in prefs:
        cur["types"].update({k: bool(v) for k, v in prefs["types"].items() if k in KINDS})
    for k in ("notify", "sender_name", "reply_to"):
        if k in prefs and prefs[k] is not None:
            cur[k] = prefs[k]
    row = await db.get(Setting, "mail")
    if row is None:
        db.add(Setting(key="mail", value=json.dumps(cur)))
    else:
        row.value = json.dumps(cur)
    await db.commit()
    return cur


async def admin_recipients(db, prefs: dict) -> list[str]:
    if prefs.get("notify"):
        return [e for e in prefs["notify"] if "@" in e]
    return list((await db.scalars(select(User.email).where(User.is_admin.is_(True)))).all())


# ------------------------------------------------------------------ plantillas
def _btn(url: str, text: str) -> str:
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td style="border-radius:12px;'
            f'background:#6C5CE7"><a href="{html.escape(url)}" style="display:inline-block;padding:14px 26px;color:#fff;'
            f'font-weight:700;text-decoration:none;font-size:16px">{html.escape(text)}</a></td></tr></table>')


def render(kind: str, ctx: dict) -> tuple[str, str, str]:
    """(asunto, html, texto) del correo"""
    e = {k: html.escape(str(v)) for k, v in ctx.items()}
    site = settings.public_url.rstrip("/")
    subject = KINDS[kind][0]
    if kind == "welcome":
        body = (f"<p>Tu cuenta de CloudPlay (<b>{e['email']}</b>) ya está lista. Tus juegos de PS2, GameCube y Wii en "
                f"cualquier pantalla: el navegador, la tele, el móvil o el ordenador.</p>{_btn(site, 'Abrir CloudPlay')}"
                "<p>En la tele entra con el código que sale en pantalla y apruébalo desde el móvil.</p>")
        text = f"Tu cuenta de CloudPlay ({ctx['email']}) ya está lista.\n\nEntra en {site}"
    elif kind == "reset":
        body = (f"<p>Alguien (esperamos que tú) ha pedido cambiar la contraseña de <b>{e['email']}</b>.</p>"
                f"{_btn(ctx['link'], 'Elegir una contraseña nueva')}<p>El enlace sirve una vez y caduca en "
                f"{e['minutes']} minutos. Si no lo has pedido tú, ignora este correo: tu contraseña no cambia.</p>")
        text = (f"Cambia la contraseña de {ctx['email']} aquí (caduca en {ctx['minutes']} min):\n{ctx['link']}\n\n"
                "Si no lo has pedido tú, ignora este correo.")
    elif kind == "password_changed":
        body = (f"<p>La contraseña de <b>{e['email']}</b> se acaba de cambiar.</p><p>Si no has sido tú, recupera la "
                f"cuenta enseguida desde {_link(site)} y avisa al administrador.</p>")
        text = f"La contraseña de {ctx['email']} se acaba de cambiar. Si no has sido tú, recupérala en {site}."
    elif kind == "lead_ack":
        body = (f"<p>Hola {e['name']}, gracias por tu interés en CloudPlay. Te escribimos en breve para preparar la "
                "demo.</p>")
        text = f"Hola {ctx['name']}, gracias por tu interés en CloudPlay. Te escribimos en breve para preparar la demo."
    elif kind == "lead":
        subject = f"Nueva solicitud de demo: {ctx['name']}"
        rows = "".join(f'<tr><td style="color:#8a8fa3;padding:4px 16px 4px 0">{k}</td><td>{e.get(f, "") or "—"}</td></tr>'
                       for k, f in (("Nombre", "name"), ("Email", "email"), ("Empresa", "company"),
                                    ("Jugadores", "players"), ("Mensaje", "message")))
        body = f'<table role="presentation" style="font-size:15px">{rows}</table>{_btn(site + "/#/admin", "Ver en el panel")}'
        text = "\n".join(f"{k}: {ctx.get(f) or '—'}" for k, f in (("Nombre", "name"), ("Email", "email"),
                         ("Empresa", "company"), ("Jugadores", "players"), ("Mensaje", "message")))
    elif kind == "node_down":
        subject = f"Nodo caído: {ctx['name']}"
        body = (f"<p>El nodo gaming <b>{e['name']}</b> ha dejado de dar señales. Sus partidas se han cerrado y las nuevas "
                f"van a los demás nodos.</p><p>{e['failed']} partida(s) afectada(s).</p>{_btn(site + '/#/admin', 'Abrir el panel')}")
        text = f"El nodo {ctx['name']} ha dejado de dar señales ({ctx['failed']} partidas afectadas). Panel: {site}/#/admin"
    else:  # test
        body = (f"<p>Si lees esto, el correo de CloudPlay funciona. 🎮</p><p>Proveedor: <b>{e['provider']}</b><br>"
                f"Remitente: <b>{e['sender']}</b></p>")
        text = f"El correo de CloudPlay funciona.\nProveedor: {ctx['provider']}\nRemitente: {ctx['sender']}"
    page = f"""<!doctype html><html lang="es"><body style="margin:0;background:#0d0f1a;padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1c1f2e">
<tr><td style="background:#151833;padding:22px 28px;color:#fff;font-size:20px;font-weight:800;letter-spacing:.02em">☁ CloudPlay</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55"><h1 style="font-size:22px;margin:0 0 16px">{html.escape(subject)}</h1>{body}</td></tr>
<tr><td style="padding:18px 28px;background:#f4f5fa;color:#8a8fa3;font-size:12px">Este correo lo envía CloudPlay ({html.escape(site)}).</td></tr>
</table></td></tr></table></body></html>"""
    return subject, page, text + f"\n\n— CloudPlay · {site}"


def _link(url: str) -> str:
    return f'<a href="{html.escape(url)}" style="color:#6C5CE7">{html.escape(url)}</a>'


# ------------------------------------------------------------------ envío
def _sender(prefs: dict) -> str:
    name, addr = parseaddr(settings.mail_from)
    return formataddr((prefs.get("sender_name") or name or "CloudPlay", addr or settings.mail_from))


def _deliver(to: list[str], subject: str, page: str, text: str, prefs: dict) -> str:
    """Envía y devuelve el id del proveedor. Bloqueante: va en un hilo."""
    sender = _sender(prefs)
    if settings.mail_provider == "resend":
        payload = {"from": sender, "to": to, "subject": subject, "html": page, "text": text}
        if prefs.get("reply_to"):
            payload["reply_to"] = prefs["reply_to"]
        req = urllib.request.Request(
            settings.resend_api_base.rstrip("/") + "/emails", data=json.dumps(payload).encode(), method="POST",
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json",
                     "User-Agent": "CloudPlay"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read() or b"{}").get("id", "")
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise RuntimeError(f"Resend {e.code}: {detail}") from None
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, ", ".join(to), subject
    msg["Message-ID"] = make_msgid(domain=(parseaddr(settings.mail_from)[1].split("@") + ["cloudplay"])[1])
    if prefs.get("reply_to"):
        msg["Reply-To"] = prefs["reply_to"]
    msg.set_content(text)
    msg.add_alternative(page, subtype="html")
    sec = settings.smtp_security
    if sec == "ssl":
        s = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20, context=ssl.create_default_context())
    else:
        s = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
    with s:
        if sec == "starttls":
            s.starttls(context=ssl.create_default_context())
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)
    return msg["Message-ID"]


async def send(kind: str, to: list[str] | str, ctx: dict, *, force: bool = False) -> dict:
    """Envía ya y espera. Devuelve {status, error}. No lanza excepciones."""
    to = [to] if isinstance(to, str) else [t for t in to if t]
    async with SessionLocal() as db:
        prefs = await get_prefs(db)
        status, error, pid = "sent", None, ""
        if not to:
            return {"status": "skipped", "error": "Sin destinatarios"}
        if not configured():
            status, error = "skipped", "Correo sin configurar (en el máster: sudo cloudplay mail setup)"
        elif not force and kind not in ALWAYS and not prefs["types"].get(kind, False):
            status, error = "skipped", "Desactivado en el panel"
        else:
            subject, page, text = render(kind, ctx)
            try:
                pid = await asyncio.to_thread(_deliver, to, subject, page, text, prefs)
            except Exception as e:  # noqa: BLE001 - se registra y sigue
                status, error = "failed", str(e)[:500]
                log.warning("correo %s a %s: %s", kind, to, e)
        db.add(MailLog(to=", ".join(to)[:500], kind=kind, status=status, error=error, provider_id=(pid or "")[:200]))
        await db.commit()
    return {"status": status, "error": error}


def queue(kind: str, to: list[str] | str, ctx: dict) -> None:
    """Envía en segundo plano (la petición que lo provoca no espera al proveedor)."""
    t = asyncio.get_running_loop().create_task(send(kind, to, ctx))
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def queue_admins(kind: str, ctx: dict) -> None:
    async with SessionLocal() as db:
        prefs = await get_prefs(db)
        to = await admin_recipients(db, prefs)
    if to:
        queue(kind, to, ctx)


async def drain() -> None:
    """Espera a los envíos en curso (tests y apagado)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


# ------------------------------------------------------------------ dominio en Resend (estado para el panel)
def _resend(method: str, path: str) -> dict:
    req = urllib.request.Request(settings.resend_api_base.rstrip("/") + path, method=method, data=b"" if method == "POST" else None,
                                 headers={"Authorization": f"Bearer {settings.resend_api_key}", "User-Agent": "CloudPlay"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read() or b"{}")


async def domain_status(verify: bool = False) -> dict | None:
    if settings.mail_provider != "resend" or not settings.resend_domain_id or not settings.resend_api_key:
        return None
    try:
        if verify:
            await asyncio.to_thread(_resend, "POST", f"/domains/{settings.resend_domain_id}/verify")
        d = await asyncio.to_thread(_resend, "GET", f"/domains/{settings.resend_domain_id}")
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:200]}
    return {"name": d.get("name"), "status": d.get("status"),
            "records": [{k: r.get(k) for k in ("record", "type", "name", "value", "status", "priority")} for r in d.get("records") or []]}


def recent_log_dict(r: MailLog) -> dict:
    return {"to": r.to, "kind": r.kind, "status": r.status, "error": r.error, "at": r.created_at.isoformat() if r.created_at else None}


__all__ = ["KINDS", "LABELS", "configured", "send", "queue", "queue_admins", "drain", "render", "get_prefs", "save_prefs",
           "domain_status", "now"]
