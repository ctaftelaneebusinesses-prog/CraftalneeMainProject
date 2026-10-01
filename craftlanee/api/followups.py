"""Client / lead follow-ups: who to call back, when, and what was said last time."""
from datetime import date, timedelta
from decimal import Decimal

from flask import request
from flask_login import current_user
from sqlalchemy import or_

from ..extensions import db
from ..models import LEAD_ACTIVITY_KINDS, LEAD_CLOSED, LEAD_SOURCES, LEAD_STATUSES, Lead, LeadActivity, now
from ..security import permission_required
from ..utils import audit, clean, parse_date, to_decimal
from . import common as S
from .common import bp, body, fail, fail_if, get_or_404, ok

DUE_FILTERS = ("overdue", "today", "week", "none")


def due_state(lead, today=None):
    """overdue | today | upcoming | none (no date set) | closed."""
    if not lead.is_open:
        return "closed"
    if not lead.next_followup:
        return "none"
    today = today or date.today()
    if lead.next_followup < today:
        return "overdue"
    return "today" if lead.next_followup == today else "upcoming"


def lead_json(l, full=False):
    data = {"id": l.id, "code": l.code, "name": l.name, "contact_person": l.contact_person, "phone": l.phone,
            "email": l.email, "source": l.source, "interest": l.interest,
            "est_value": S.money(l.est_value) if l.est_value is not None else None,
            "status": l.status, "next_followup": S.iso(l.next_followup), "due": due_state(l),
            "notes": l.notes, "closed_at": S.iso(l.closed_at), "created_by_name": l.created_by_name,
            "created_at": S.iso(l.created_at), "updated_at": S.iso(l.updated_at),
            "activity_count": len(l.activities),
            "last_activity": activity_json(l.activities[0]) if l.activities else None}
    if full:
        data["activities"] = [activity_json(a) for a in l.activities]
    return data


def activity_json(a):
    return {"id": a.id, "kind": a.kind, "body": a.body, "author_name": a.author_name, "created_at": S.iso(a.created_at)}


def _set_status(lead, status):
    if status not in LEAD_STATUSES or status == lead.status:
        return
    lead.status = status
    lead.closed_at = now() if status in LEAD_CLOSED else None
    if status in LEAD_CLOSED:
        lead.next_followup = None


def _apply(lead, d):
    lead.name = clean(d, "name", 160)
    lead.contact_person = clean(d, "contact_person", 120) or None
    lead.phone = clean(d, "phone", 40) or None
    lead.email = clean(d, "email", 160) or None
    lead.source = d.get("source") if d.get("source") in LEAD_SOURCES else None
    lead.interest = clean(d, "interest", 200) or None
    value = to_decimal(d.get("est_value"))
    lead.est_value = value if value > 0 else None
    lead.notes = clean(d, "notes", 4000) or None
    lead.next_followup = parse_date(d.get("next_followup"))
    _set_status(lead, d.get("status") or lead.status or "new")
    errors = []
    if not lead.name:
        errors.append("Client / lead name is required.")
    if lead.email and "@" not in lead.email:
        errors.append("That email address doesn't look right.")
    return errors


def counts():
    """Open-pipeline numbers for the page header, the dashboard and the nav badge."""
    today = date.today()
    open_q = Lead.query.filter(Lead.status.notin_(LEAD_CLOSED))
    overdue = open_q.filter(Lead.next_followup < today).count()
    due_today = open_q.filter(Lead.next_followup == today).count()
    week = open_q.filter(Lead.next_followup > today, Lead.next_followup <= today + timedelta(days=7)).count()
    open_rows = open_q.all()
    return {"overdue": overdue, "today": due_today, "week": week, "open": len(open_rows),
            "no_date": sum(1 for l in open_rows if not l.next_followup),
            "pipeline": S.money(sum((Decimal(l.est_value or 0) for l in open_rows), Decimal(0))),
            "won": Lead.query.filter_by(status="won").count(), "lost": Lead.query.filter_by(status="lost").count()}


def due_count():
    """Open leads to follow up today or already overdue (the nav badge)."""
    return Lead.query.filter(Lead.status.notin_(LEAD_CLOSED), Lead.next_followup <= date.today()).count()


def due_soon(limit=6):
    """Open leads whose follow-up is overdue or today, most overdue first."""
    rows = (Lead.query.filter(Lead.status.notin_(LEAD_CLOSED), Lead.next_followup <= date.today())
            .order_by(Lead.next_followup, Lead.id).limit(limit).all())
    return [lead_json(l) for l in rows]


@bp.get("/followups")
@permission_required("followups")
def followups_list():
    q, status, due = clean(request.args, "q", 100), request.args.get("status", ""), request.args.get("due", "")
    today = date.today()
    query = Lead.query
    if status == "open":
        query = query.filter(Lead.status.notin_(LEAD_CLOSED))
    elif status in LEAD_STATUSES:
        query = query.filter_by(status=status)
    if due in DUE_FILTERS:
        query = query.filter(Lead.status.notin_(LEAD_CLOSED))
        if due == "overdue":
            query = query.filter(Lead.next_followup < today)
        elif due == "today":
            query = query.filter(Lead.next_followup == today)
        elif due == "week":
            query = query.filter(Lead.next_followup >= today, Lead.next_followup <= today + timedelta(days=7))
        else:
            query = query.filter(Lead.next_followup.is_(None))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Lead.name.ilike(like), Lead.contact_person.ilike(like), Lead.phone.ilike(like),
                                 Lead.email.ilike(like), Lead.interest.ilike(like), Lead.notes.ilike(like)))
    # Open leads with a date first (soonest / most overdue on top), then undated, then closed.
    rows = query.all()
    rows.sort(key=lambda l: (not l.is_open, l.next_followup is None, l.next_followup or date.max,
                             -(l.updated_at.timestamp() if l.updated_at else 0)))
    return ok(rows=[lead_json(l) for l in rows], counts=counts(),
              statuses=LEAD_STATUSES, sources=LEAD_SOURCES, activity_kinds=LEAD_ACTIVITY_KINDS)


@bp.get("/followups/<int:lead_id>")
@permission_required("followups")
def followups_get(lead_id):
    return ok(lead=lead_json(get_or_404(Lead, lead_id, "Lead"), full=True))


@bp.post("/followups")
@permission_required("followups")
def followups_create():
    lead = Lead(created_by_name=current_user.name)
    fail_if(_apply(lead, body()))
    db.session.add(lead)
    db.session.flush()
    audit("added a follow-up lead", "followup", f"{lead.code} · {lead.name}")
    db.session.commit()
    return ok(lead=lead_json(lead, full=True)), 201


@bp.put("/followups/<int:lead_id>")
@permission_required("followups")
def followups_update(lead_id):
    lead = get_or_404(Lead, lead_id, "Lead")
    errors = _apply(lead, body())
    if errors:
        db.session.rollback()
        fail_if(errors)
    audit("updated a follow-up lead", "followup", f"{lead.code} · {lead.name} · {lead.status}")
    db.session.commit()
    return ok(lead=lead_json(lead, full=True))


@bp.delete("/followups/<int:lead_id>")
@permission_required("followups")
def followups_delete(lead_id):
    lead = get_or_404(Lead, lead_id, "Lead")
    audit("deleted a follow-up lead", "followup", f"{lead.code} · {lead.name}")
    db.session.delete(lead)
    db.session.commit()
    return ok(deleted=True)


@bp.post("/followups/<int:lead_id>/log")
@permission_required("followups")
def followups_log(lead_id):
    """Log a call / meeting / note and, in the same step, set the next follow-up date and status."""
    lead = get_or_404(Lead, lead_id, "Lead")
    d = body()
    text = clean(d, "body", 4000)
    if not text:
        fail("Write what happened on this follow-up.")
    kind = d.get("kind") if d.get("kind") in LEAD_ACTIVITY_KINDS else "Note"
    db.session.add(LeadActivity(lead=lead, kind=kind, body=text, author_id=current_user.id,
                                author_name=current_user.name))
    if "next_followup" in d:
        lead.next_followup = parse_date(d.get("next_followup"))
    if d.get("status"):
        _set_status(lead, d.get("status"))
    if lead.status == "new" and kind != "Note":
        lead.status = "contacted"
    lead.updated_at = now()
    audit(f"logged a {kind.lower()} with a lead", "followup", f"{lead.code} · {lead.name}")
    db.session.commit()
    db.session.refresh(lead)
    return ok(lead=lead_json(lead, full=True))


@bp.delete("/followups/<int:lead_id>/log/<int:activity_id>")
@permission_required("followups")
def followups_log_delete(lead_id, activity_id):
    lead = get_or_404(Lead, lead_id, "Lead")
    entry = get_or_404(LeadActivity, activity_id, "Entry")
    if entry.lead_id != lead.id:
        fail("Entry not found.", 404)
    db.session.delete(entry)
    db.session.commit()
    db.session.refresh(lead)
    return ok(lead=lead_json(lead, full=True))
