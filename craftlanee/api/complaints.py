"""Complaints box: anyone on the team (interns included) raises a complaint; the founder and admins with the
"complaints" area (e.g. the project manager) read it, reply and resolve it.

A complaint can be anonymous (the name is hidden from whoever reads it) and/or founder-only (hidden from
everyone but the founder, e.g. when it is about the project manager). The person who raised it always sees
their own complaints and the replies.
"""
from flask import request
from flask_login import current_user, login_required

from ..extensions import db
from ..models import COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, Complaint, now
from ..security import employee_required, permission_required
from ..utils import audit, clean
from . import common as S
from .common import bp, body, fail, get_or_404, ok


def _reviewer_query():
    """Complaints the current admin may read (founder-only ones are for founder logins)."""
    q = Complaint.query
    if not current_user.is_founder:
        q = q.filter(Complaint.founder_only.is_(False))
    return q


def open_count(user):
    """Unresolved complaints waiting for this user (the nav badge)."""
    if not user.can("complaints"):
        return 0
    q = Complaint.query.filter(Complaint.status != "resolved")
    if not user.is_founder:
        q = q.filter(Complaint.founder_only.is_(False))
    return q.count()


def _ser(c, reviewer=False):
    mine = c.employee_id == current_user.employee_id
    show_name = mine or not c.anonymous
    return {"id": c.id, "code": c.code, "subject": c.subject, "category": c.category, "message": c.message,
            "anonymous": c.anonymous, "founder_only": c.founder_only, "status": c.status,
            "response": c.response, "responded_by": c.responded_by, "responded_at": S.iso(c.responded_at),
            "resolved_at": S.iso(c.resolved_at), "created_at": S.iso(c.created_at), "updated_at": S.iso(c.updated_at),
            "mine": mine,
            "raised_by": (S.employee_brief(c.employee) if show_name and c.employee else None) if reviewer or mine else None}


@bp.get("/complaints")
@login_required
def complaints_list():
    mine = []
    if current_user.employee_id:
        mine = (Complaint.query.filter_by(employee_id=current_user.employee_id)
                .order_by(Complaint.created_at.desc()).all())
    reviewer = current_user.can("complaints")
    everyone = []
    if reviewer:
        q = _reviewer_query()
        status = request.args.get("status", "")
        if status in COMPLAINT_STATUSES:
            q = q.filter_by(status=status)
        everyone = q.order_by(Complaint.created_at.desc()).limit(500).all()
    return ok(mine=[_ser(c) for c in mine], all=[_ser(c, reviewer=True) for c in everyone],
              can_review=reviewer, can_raise=bool(current_user.employee_id),
              categories=COMPLAINT_CATEGORIES, open=open_count(current_user))


@bp.post("/complaints")
@employee_required
def complaints_create():
    d = body()
    c = Complaint(employee_id=current_user.employee_id, subject=clean(d, "subject", 200),
                  message=clean(d, "message", 10000),
                  category=d.get("category") if d.get("category") in COMPLAINT_CATEGORIES else "Other",
                  anonymous=bool(d.get("anonymous")), founder_only=bool(d.get("founder_only")))
    if not c.subject:
        fail("Add a short subject.")
    if not c.message:
        fail("Describe the complaint.")
    db.session.add(c)
    db.session.flush()
    if not c.anonymous:  # the audit log records who acted, so anonymous complaints aren't logged
        audit("raised a complaint", "complaint", f"{c.code} · {c.category}")
    db.session.commit()
    return ok(complaint=_ser(c)), 201


@bp.put("/complaints/<int:complaint_id>")
@permission_required("complaints")
def complaints_update(complaint_id):
    c = get_or_404(Complaint, complaint_id, "Complaint")
    if c.founder_only and not current_user.is_founder:
        fail("Complaint not found.", 404)
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
    return ok(complaint=_ser(c, reviewer=True))
