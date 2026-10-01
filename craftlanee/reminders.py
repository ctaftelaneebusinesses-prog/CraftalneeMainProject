"""Follow-up reminders: which leads are due now, and the background email sender.

The browser shows desktop pop-ups itself (it polls /api/followups/reminders). Emails go out from a daemon
thread started by serve.py / run.py, so they arrive even when nobody has the app open. Each lead is emailed
once per date + time: changing either clears `reminded_at` and re-arms it.
"""
import logging
import os
import re
import smtplib
import ssl
import threading
import time
from datetime import timedelta
from email.message import EmailMessage
from html import escape

from .extensions import db
from .models import LEAD_CLOSED, Lead, User, now

log = logging.getLogger("craftlanee.reminders")

EMAIL_LOOKBACK = timedelta(days=2)   # never email reminders older than this (e.g. after the server was off)
CHECK_EVERY = 60                     # seconds
RETRY_AFTER = 600                    # seconds to wait after a mail server error

_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)")


def parse_time(value):
    """"9:5" / "09:05" / "09:05:00" -> "09:05"; anything else -> None."""
    m = _TIME.match(str(value or "").strip())
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def due_now(at=None):
    """Open leads whose follow-up date/time has arrived, oldest first."""
    at = at or now()
    rows = Lead.query.filter(Lead.status.notin_(LEAD_CLOSED), Lead.next_followup.isnot(None),
                             Lead.next_followup <= at.date()).all()
    return sorted((l for l in rows if l.remind_at <= at), key=lambda l: (l.remind_at, l.id))


def later_today(at=None):
    at = at or now()
    rows = Lead.query.filter(Lead.status.notin_(LEAD_CLOSED), Lead.next_followup == at.date()).all()
    return sorted((l for l in rows if l.remind_at > at), key=lambda l: (l.remind_at, l.id))


def recipients():
    """Every active login that may use follow-ups (the founder and admins granted the area)."""
    return [u for u in User.query.filter_by(active=True).all() if u.is_active and u.can("followups")]


# ------------------------------------------------------------------ email

def smtp_ready(s):
    return bool(s and s.smtp_host and s.smtp_from)


def send_mail(s, to, subject, text, html=None):
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, s.smtp_from, ", ".join(to)
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    port = s.smtp_port or 587
    context = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(s.smtp_host, port, timeout=20, context=context)
    else:
        server = smtplib.SMTP(s.smtp_host, port, timeout=20)
    with server:
        if port != 465:
            server.ehlo()
            if server.has_extn("starttls"):
                server.starttls(context=context)
                server.ehlo()
        if s.smtp_user:
            server.login(s.smtp_user, s.smtp_password or "")
        server.send_message(msg)


def _when(l):
    at = l.remind_at
    return f"{at.day} {at:%b}, {at.hour % 12 or 12}:{at:%M %p}"  # "1 Oct, 9:05 AM" on every OS


def reminder_email(leads, s):
    link = (s.app_url or "").rstrip("/")
    company = s.company_name or "CraftLanee"
    subject = (f"Follow up with {leads[0].name}" if len(leads) == 1
               else f"{len(leads)} client follow-ups are due") + f" · {company}"
    lines, cards = [], []
    for l in leads:
        last = l.activities[0] if l.activities else None
        bits = [x for x in (l.contact_person, l.phone, l.email) if x]
        lines.append(f"• {l.name} — due {_when(l)}" + (f"\n  {' · '.join(bits)}" if bits else "")
                     + (f"\n  Last: {last.kind}: {last.body[:200]}" if last else ""))
        cards.append(
            "<tr><td style='padding:12px 14px;border:1px solid #e6e3f0;border-radius:10px'>"
            f"<div style='font-weight:600;font-size:15px'>{escape(l.name)}</div>"
            f"<div style='color:#b45309;font-size:13px;margin-top:2px'>Due {escape(_when(l))}</div>"
            + (f"<div style='color:#555;font-size:13px;margin-top:4px'>{escape(' · '.join(bits))}</div>" if bits else "")
            + (f"<div style='color:#777;font-size:13px;margin-top:6px'>Last {escape(last.kind.lower())}: "
               f"{escape(last.body[:200])}</div>" if last else "")
            + "</td></tr><tr><td style='height:8px'></td></tr>")
    open_link = f"{link}/followups?due=today" if link else ""
    text = "These client follow-ups are due:\n\n" + "\n\n".join(lines) + (f"\n\nOpen follow-ups: {open_link}" if link else "")
    html = ("<div style='font-family:Segoe UI,Arial,sans-serif;max-width:560px;color:#1d1b26'>"
            f"<h2 style='font-size:18px;margin:0 0 12px'>{escape(subject)}</h2>"
            f"<table style='width:100%;border-collapse:separate'>{''.join(cards)}</table>"
            + (f"<p><a href='{escape(open_link)}' style='display:inline-block;background:#7c5cff;color:#fff;"
               "padding:10px 16px;border-radius:8px;text-decoration:none'>Open follow-ups</a></p>" if link else "")
            + f"<p style='color:#999;font-size:12px'>Sent by {escape(company)} because these follow-ups reached "
              "their date and time.</p></div>")
    return subject, text, html


def send_due_emails(at=None):
    """Email every lead that came due and hasn't been emailed yet. Returns how many leads were included."""
    from .utils import get_settings
    s = get_settings()
    if not (s.reminder_emails and smtp_ready(s)):
        return 0
    at = at or now()
    leads = [l for l in due_now(at) if l.reminded_at is None and l.remind_at >= at - EMAIL_LOOKBACK]
    to = sorted({u.email for u in recipients() if u.email})
    if not leads or not to:
        return 0
    subject, text, html = reminder_email(leads, s)
    send_mail(s, to, subject, text, html)  # raises on failure → nothing is marked, retried later
    for l in leads:
        l.reminded_at = at
    db.session.commit()
    log.info("follow-up reminder emailed to %s for %d lead(s)", ", ".join(to), len(leads))
    return len(leads)


_started = False


def start(app):
    """Start the background email loop once per process. CRAFTLANEE_REMINDERS=0 turns it off."""
    global _started
    if _started or os.environ.get("CRAFTLANEE_REMINDERS") == "0":
        return
    _started = True

    def loop():
        while True:
            wait = CHECK_EVERY
            try:
                with app.app_context():
                    send_due_emails()
            except (smtplib.SMTPException, OSError) as exc:
                log.warning("follow-up reminder email failed, retrying in %ds: %s", RETRY_AFTER, exc)
                wait = RETRY_AFTER
            except Exception:  # noqa: BLE001 — keep the loop alive whatever happens
                log.exception("follow-up reminder check failed")
            finally:
                with app.app_context():
                    db.session.remove()
            time.sleep(wait)

    threading.Thread(target=loop, name="followup-reminders", daemon=True).start()
