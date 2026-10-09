"""Sheets: Drive links (Excel, Google Sheets, Docs, anything) that anyone adds and shares with chosen people.

Founder logins and the project manager (admins with the "projects" area) see every sheet by default.
Everyone else sees the sheets they added and the ones shared with them. Only the person who added a sheet
(or a founder / the project manager) may edit or delete it.
"""
from flask_login import current_user, login_required

from ..extensions import db
from ..models import Employee, Sheet
from ..utils import audit, clean
from . import common as S
from .common import bp, body, fail, get_or_404, ok
from .projects import _link


def sees_all(user):
    return user.is_founder or user.can("projects")


def _visible_query():
    if sees_all(current_user):
        return Sheet.query
    mine = Sheet.owner_id == current_user.id
    if not current_user.employee_id:
        return Sheet.query.filter(mine)
    return Sheet.query.filter(db.or_(mine, Sheet.recipients.any(Employee.id == current_user.employee_id)))


def _can_edit(s):
    return s.owner_id == current_user.id or sees_all(current_user)


def _ser(s):
    return {"id": s.id, "title": s.title, "link": s.link, "notes": s.notes, "owner_name": s.owner_name,
            "mine": s.owner_id == current_user.id, "can_edit": _can_edit(s),
            "recipients": [{"id": e.id, "full_name": e.full_name} for e in s.recipients],
            "created_at": S.iso(s.created_at), "updated_at": S.iso(s.updated_at)}


def _people():
    """Active teammates a sheet can be shared with (never yourself)."""
    rows = Employee.query.filter_by(status="active").order_by(Employee.full_name).all()
    return [e for e in rows if e.id != current_user.employee_id]


def _person(e):
    return {"id": e.id, "full_name": e.full_name, "initials": e.initials, "designation": e.designation,
            "employment_type": e.employment_type, "photo_url": S.file_url("photo", e) if e.photo_path else None}


def _apply(s, d):
    s.title = clean(d, "title", 200)
    s.notes = clean(d, "notes", 10000) or None
    s.link = _link(d.get("link"))
    if not s.title:
        fail("Give the sheet a name.")
    if not s.link:
        fail("Paste the Drive link.")
    try:
        ids = {int(x) for x in (d.get("recipient_ids") or [])}
    except (TypeError, ValueError):
        fail("Choose who to share it with.")
    allowed = {e.id: e for e in _people()}
    s.recipients = [allowed[i] for i in ids if i in allowed]


@bp.get("/sheets")
@login_required
def sheets_list():
    rows = _visible_query().order_by(Sheet.created_at.desc()).limit(500).all()
    return ok(sheets=[_ser(s) for s in rows], sees_all=sees_all(current_user),
              people=[_person(e) for e in _people()])


@bp.post("/sheets")
@login_required
def sheets_create():
    s = Sheet(owner_id=current_user.id, owner_name=current_user.name)
    _apply(s, body())
    db.session.add(s)
    db.session.flush()
    audit(f"added sheet “{s.title}”", "document", f"shared with {len(s.recipients)}")
    db.session.commit()
    return ok(sheet=_ser(s)), 201


def _editable(sheet_id):
    s = get_or_404(Sheet, sheet_id, "Sheet")
    if not _can_edit(s):
        fail("Sheet not found.", 404)
    return s


@bp.put("/sheets/<int:sheet_id>")
@login_required
def sheets_update(sheet_id):
    s = _editable(sheet_id)
    _apply(s, body())
    audit(f"updated sheet “{s.title}”", "document", f"shared with {len(s.recipients)}")
    db.session.commit()
    return ok(sheet=_ser(s))


@bp.delete("/sheets/<int:sheet_id>")
@login_required
def sheets_delete(sheet_id):
    s = _editable(sheet_id)
    audit(f"deleted sheet “{s.title}”", "document", "")
    db.session.delete(s)
    db.session.commit()
    return ok(deleted=True)
