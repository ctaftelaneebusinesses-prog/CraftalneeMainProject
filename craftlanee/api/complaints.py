"""Complaints box: anyone on the team (interns included) raises a complaint and chooses who receives it —
the founder, the complaints manager, someone above them in the team tree, or an admin given the
"complaints" area.

Founder logins and the complaints manager (one person, chosen by the main founder in Settings) see every
complaint, with the name of whoever raised it. Founders can delete complaints. Anyone else sees only the
complaints sent to them, without the name if the sender hid it from them. The person who raised a complaint
always sees it, its status and the reply.
"""
from flask import request
from flask_login import current_user, login_required

from ..extensions import db
from ..models import COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, Complaint, Employee, User, now
from ..security import employee_required
from ..utils import audit, clean, get_settings
from . import common as S
from .common import bp, body, fail, get_or_404, ok


def manager_id():
    """Employee id of the complaints manager, if one is set."""
    return get_settings().complaints_manager_id


def sees_all(user):
    """Founder logins and the complaints manager read every complaint, names included."""
    return user.is_founder or bool(user.employee_id and user.employee_id == manager_id())


def _received_query(user):
    """Complaints this user reads: all of them for a founder / the complaints manager, else the ones sent to them."""
    if sees_all(user):
        return Complaint.query
    if not user.employee_id:
        return Complaint.query.filter(db.false())
    return Complaint.query.filter(Complaint.recipient_id == user.employee_id)


def open_count(user):
    """Unresolved complaints waiting for this user (the nav badge)."""
    return _received_query(user).filter(Complaint.status != "resolved").count()


def recipients_for(emp):
    """Who `emp` may send a complaint to: the complaints manager, people above them in the team tree, and
    anyone given the complaints area. Only people with an active login (so they can read it), never themselves."""
    head = db.session.get(Employee, manager_id() or 0)
    chain, seen, boss = ([head] if head and head.id != emp.id else []), {emp.id} | ({head.id} if head else set()), emp.manager
    while boss is not None and boss.id not in seen:
        seen.add(boss.id)
        chain.append(boss)
        boss = boss.manager
    area = [u.employee for u in User.query.filter(User.employee_id.isnot(None), User.active.is_(True)).all()
            if u.is_active and u.can("complaints") and u.employee_id not in seen]
    people = chain + sorted(area, key=lambda e: e.full_name.lower())
    return [e for e in people if e.status == "active" and e.user and e.user.is_active]


def _ser(c):
    mine = c.employee_id == current_user.employee_id
    show_name = mine or sees_all(current_user) or not c.anonymous
    return {"id": c.id, "code": c.code, "subject": c.subject, "category": c.category, "message": c.message,
            "anonymous": c.anonymous, "status": c.status,
            "sent_to": {"id": c.recipient.id, "full_name": c.recipient.full_name} if c.recipient else None,
            "response": c.response, "responded_by": c.responded_by, "responded_at": S.iso(c.responded_at),
            "resolved_at": S.iso(c.resolved_at), "created_at": S.iso(c.created_at), "updated_at": S.iso(c.updated_at),
            "mine": mine, "raised_by": S.employee_brief(c.employee) if show_name and c.employee else None}


@bp.get("/complaints")
@login_required
def complaints_list():
    emp = current_user.employee
    mine = (Complaint.query.filter_by(employee_id=emp.id).order_by(Complaint.created_at.desc()).all() if emp else [])
    q = _received_query(current_user)
    status = request.args.get("status", "")
    if status in COMPLAINT_STATUSES:
        q = q.filter_by(status=status)
    received = q.order_by(Complaint.created_at.desc()).limit(500).all()
    can_review = sees_all(current_user) or current_user.can("complaints") or bool(received)
    return ok(mine=[_ser(c) for c in mine], all=[_ser(c) for c in received],
              can_review=can_review, can_delete=current_user.is_founder, can_raise=emp is not None,
              manager_id=manager_id(),
              recipients=[S.employee_brief(e) for e in recipients_for(emp)] if emp else [],
              categories=COMPLAINT_CATEGORIES, open=open_count(current_user))


@bp.post("/complaints")
@employee_required
def complaints_create():
    d = body()
    emp = current_user.employee
    recipient = None
    if d.get("recipient_id") not in (None, "", 0, "0"):
        try:
            rid = int(d.get("recipient_id"))
        except (TypeError, ValueError):
            fail("Choose who should receive the complaint.")
        recipient = next((e for e in recipients_for(emp) if e.id == rid), None)
        if recipient is None:
            fail("You can't send a complaint to that person.")
    # Demo behaviour (final-year project): "hide my name" is offered for every recipient, but founder logins and
    # the complaints manager still see the name (see sees_all); only other recipients have it hidden.
    c = Complaint(employee_id=emp.id, subject=clean(d, "subject", 200), message=clean(d, "message", 10000),
                  category=d.get("category") if d.get("category") in COMPLAINT_CATEGORIES else "Other",
                  anonymous=bool(d.get("anonymous")), recipient_id=recipient.id if recipient else None,
                  founder_only=recipient is None)
    if not c.subject:
        fail("Add a short subject.")
    if not c.message:
        fail("Describe the complaint.")
    db.session.add(c)
    db.session.flush()
    if not c.anonymous:  # the audit log records who acted
        audit("raised a complaint", "complaint", f"{c.code} · {c.category}")
    db.session.commit()
    return ok(complaint=_ser(c)), 201


def _reviewable(complaint_id):
    c = get_or_404(Complaint, complaint_id, "Complaint")
    if not (sees_all(current_user) or (current_user.employee_id and c.recipient_id == current_user.employee_id)):
        fail("Complaint not found.", 404)
    return c


@bp.put("/complaints/<int:complaint_id>")
@login_required
def complaints_update(complaint_id):
    c = _reviewable(complaint_id)
    d = body()
    if "response" in d:
        response = clean(d, "response", 10000) or None
        if response != c.response:
            c.response, c.responded_by, c.responded_at = response, current_user.name, now()
    status = d.get("status")
    if status in COMPLAINT_STATUSES and status != c.status:
        c.status = status
        c.resolved_at = now() if status == "resolved" else None
    audit(f"updated complaint {c.code}", "complaint", c.status)
    db.session.commit()
    return ok(complaint=_ser(c))


@bp.delete("/complaints/<int:complaint_id>")
@login_required
def complaints_delete(complaint_id):
    if not current_user.is_founder:
        fail("You don't have permission to do that.", 403)
    c = get_or_404(Complaint, complaint_id, "Complaint")
    audit(f"deleted complaint {c.code}", "complaint", c.subject[:120])
    db.session.delete(c)
    db.session.commit()
    return ok(deleted=True)
