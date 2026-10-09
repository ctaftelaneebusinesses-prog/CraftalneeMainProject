"""Shared links (stored as "sheets"): Drive links to Excel, Google Sheets, Docs, anything — that anyone adds and shares with chosen people.

Each person a sheet is shared with gets an access level:
  view — open it;  edit — also change its name, link and notes;  full — also change who it's shared with, and delete.
The person who added it, founder logins and the project manager (admins with the "projects" area) always have
full access, and founders / the project manager see every sheet by default.
"""
from flask_login import current_user, login_required

from ..extensions import db
from ..models import SHEET_ACCESS, Employee, Sheet, SheetShare
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
    return Sheet.query.filter(db.or_(mine, Sheet.shares.any(SheetShare.employee_id == current_user.employee_id)))


def _access(s):
    """What the current user may do with `s`: "full", "edit", "view" or None."""
    if s.owner_id == current_user.id or sees_all(current_user):
        return "full"
    share = next((x for x in s.shares if x.employee_id == current_user.employee_id), None)
    return share.access if share else None


def _ser(s):
    access = _access(s)
    return {"id": s.id, "title": s.title, "link": s.link, "notes": s.notes, "owner_name": s.owner_name,
            "mine": s.owner_id == current_user.id, "access": access,
            "can_edit": access in ("edit", "full"), "can_manage": access == "full",
            "recipients": [{"id": x.employee_id, "full_name": x.employee.full_name, "access": x.access}
                           for x in s.shares if x.employee],
            "created_at": S.iso(s.created_at), "updated_at": S.iso(s.updated_at)}


def _person(e):
    return {"id": e.id, "full_name": e.full_name, "initials": e.initials, "designation": e.designation,
            "employment_type": e.employment_type, "photo_url": S.file_url("photo", e) if e.photo_path else None}


def _people():
    """Active teammates a sheet can be shared with (never yourself)."""
    rows = Employee.query.filter_by(status="active").order_by(Employee.full_name).all()
    return [e for e in rows if e.id != current_user.employee_id]


def _apply_details(s, d):
    s.title = clean(d, "title", 200)
    s.notes = clean(d, "notes", 10000) or None
    s.link = _link(d.get("link"))
    if not s.title:
        fail("Give the link a name.")
    if not s.link:
        fail("Paste the link.")


def _apply_shares(s, d):
    """`shares`: [{"id": employee id, "access": "view" | "edit" | "full"}]."""
    wanted = {}
    try:
        for row in d.get("shares") or []:
            wanted[int(row["id"])] = row.get("access") if row.get("access") in SHEET_ACCESS else "view"
    except (TypeError, ValueError, KeyError):
        fail("Choose who to share it with.")
    allowed = {e.id for e in _people()} | {x.employee_id for x in s.shares}
    current = {x.employee_id: x for x in s.shares}
    me = current.get(current_user.employee_id)
    if me is not None:  # a full-access recipient can't change or drop their own share
        wanted[me.employee_id] = me.access
    s.shares = [current.get(eid) or SheetShare(employee_id=eid) for eid in wanted if eid in allowed]
    for x in s.shares:
        x.access = wanted[x.employee_id]


@bp.get("/sheets")
@login_required
def sheets_list():
    rows = _visible_query().order_by(Sheet.created_at.desc()).limit(500).all()
    return ok(sheets=[_ser(s) for s in rows], sees_all=sees_all(current_user),
              people=[_person(e) for e in _people()], access_levels=SHEET_ACCESS)


@bp.post("/sheets")
@login_required
def sheets_create():
    d = body()
    s = Sheet(owner_id=current_user.id, owner_name=current_user.name)
    _apply_details(s, d)
    _apply_shares(s, d)
    db.session.add(s)
    db.session.flush()
    audit(f"shared link “{s.title}”", "document", f"shared with {len(s.shares)}")
    db.session.commit()
    return ok(sheet=_ser(s)), 201


def _allowed(sheet_id, *levels):
    s = get_or_404(Sheet, sheet_id, "Link")
    access = _access(s)
    if access is None:
        fail("Link not found.", 404)
    if access not in levels:
        fail("You don't have permission to do that.", 403)
    return s, access


@bp.put("/sheets/<int:sheet_id>")
@login_required
def sheets_update(sheet_id):
    s, access = _allowed(sheet_id, "edit", "full")
    d = body()
    _apply_details(s, d)
    if access == "full" and "shares" in d:  # editors change the content only, not who sees it
        _apply_shares(s, d)
    audit(f"updated shared link “{s.title}”", "document", f"shared with {len(s.shares)}")
    db.session.commit()
    return ok(sheet=_ser(s))


@bp.delete("/sheets/<int:sheet_id>")
@login_required
def sheets_delete(sheet_id):
    s, _ = _allowed(sheet_id, "full")
    audit(f"deleted shared link “{s.title}”", "document", "")
    db.session.delete(s)
    db.session.commit()
    return ok(deleted=True)
