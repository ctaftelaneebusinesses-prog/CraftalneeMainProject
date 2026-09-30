"""Announcements: posts to everyone or chosen employees, with links (YouTube plays inline) and photos.

Anyone signed in reads the announcements addressed to them; the founder and admins with the
"announcements" area post, edit and delete, and see who has read each one.
"""
import json
import re
from urllib.parse import urlparse

from flask import request
from flask_login import current_user, login_required

from ..extensions import db
from ..models import Announcement, AnnouncementPhoto, AnnouncementRead, Employee, now
from ..security import permission_required
from ..utils import IMAGE_EXTS, audit, clean, delete_file, save_upload
from . import common as S
from .common import bp, body, fail, get_or_404, ok

MAX_PHOTOS = 12
MAX_LINKS = 10
SCHEME_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.-]*):(?!\d)")  # "mailto:", "javascript:" — but not "host:8080"


def _manager():
    return current_user.can("announcements")


def _visible_query():
    q = Announcement.query
    if _manager():
        return q
    if not current_user.employee_id:
        return q.filter(db.false())
    mine = Announcement.recipients.any(Employee.id == current_user.employee_id)
    return q.filter(db.or_(Announcement.audience == "all", mine))


def _audience_ids(a):
    """Active employees this announcement reaches."""
    if a.audience == "all":
        return {eid for (eid,) in db.session.query(Employee.id).filter_by(status="active")}
    return {e.id for e in a.recipients if e.status == "active"}


def _ser(a, read_ids=None):
    data = {
        "id": a.id, "title": a.title, "body": a.body, "links": a.link_list, "audience": a.audience,
        "pinned": a.pinned, "author_name": a.author_name, "created_at": S.iso(a.created_at),
        "updated_at": S.iso(a.updated_at), "edited": bool(a.updated_at and a.created_at
                                                          and (a.updated_at - a.created_at).total_seconds() > 60),
        "recipients": [{"id": e.id, "full_name": e.full_name} for e in a.recipients] if a.audience == "selected" else [],
        "photos": [{"id": p.id, "url": f"/files/announcement/{p.id}", "name": p.original_name} for p in a.photos],
        "read": a.id in read_ids if read_ids is not None else True,
    }
    if _manager():
        reach = _audience_ids(a)
        data["reach"] = len(reach)
        data["seen"] = sum(1 for r in a.reads if r.employee_id in reach)
    return data


def _links(raw):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "[]")
        except ValueError:
            fail("Links are invalid.")
    out = []
    for item in raw if isinstance(raw, list) else []:
        url = str((item or {}).get("url") or "").strip()[:1000] if isinstance(item, dict) else ""
        if not url:
            continue
        scheme = SCHEME_RE.match(url)
        if scheme and scheme.group(1).lower() not in ("http", "https"):
            fail(f"“{url[:60]}” isn't a web link. Links must start with http:// or https://.")
        if "://" not in url:
            url = "https://" + url
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            fail(f"“{url}” isn't a web link. Links must start with http:// or https://.")
        out.append({"url": url, "label": str(item.get("label") or "").strip()[:120]})
    if len(out) > MAX_LINKS:
        fail(f"Add at most {MAX_LINKS} links.")
    return out


def _apply(a, form):
    a.title = clean(form, "title", 200)
    a.body = clean(form, "body", 10000) or None
    if not a.title:
        fail("Give the announcement a title.")
    a.links = json.dumps(_links(form.get("links")))
    a.pinned = str(form.get("pinned", "")).lower() in ("1", "true")
    a.audience = "selected" if form.get("audience") == "selected" else "all"
    if a.audience == "selected":
        raw = form.get("recipient_ids") or "[]"
        try:
            ids = {int(x) for x in (json.loads(raw) if isinstance(raw, str) else raw)}
        except (TypeError, ValueError):
            fail("Choose who should see this.")
        people = Employee.query.filter(Employee.id.in_(ids or {-1})).all()
        if not people:
            fail("Choose at least one person, or send it to everyone.")
        a.recipients = people
    else:
        a.recipients = []


def _save_photos(a, files):
    uploads = [f for f in files.getlist("photos") if f and f.filename]
    if len(a.photos) + len(uploads) > MAX_PHOTOS:
        fail(f"An announcement can have at most {MAX_PHOTOS} photos.")
    saved = []
    try:
        start = max((p.position for p in a.photos), default=0)
        for i, f in enumerate(uploads, 1):
            rel, original = save_upload(f, "announcements", IMAGE_EXTS)
            saved.append(rel)
            a.photos.append(AnnouncementPhoto(file_path=rel, original_name=original, position=start + i))
    except ValueError as exc:
        for rel in saved:
            delete_file(rel)
        fail(str(exc))
    return saved


@bp.get("/announcements")
@login_required
def announcements_list():
    rows = _visible_query().order_by(Announcement.pinned.desc(), Announcement.created_at.desc()).limit(200).all()
    read_ids = set()
    if current_user.employee_id:
        read_ids = {aid for (aid,) in db.session.query(AnnouncementRead.announcement_id)
                    .filter_by(employee_id=current_user.employee_id)}
    items = [_ser(a, read_ids if current_user.employee_id else None) for a in rows]
    return ok(announcements=items, unread=sum(1 for i in items if not i["read"]), can_post=_manager())


@bp.post("/announcements/read")
@login_required
def announcements_mark_read():
    """Mark the given (or all visible) announcements as seen by the current employee."""
    if not current_user.employee_id:
        return ok(marked=0)
    ids = body().get("ids")
    q = _visible_query()
    if isinstance(ids, list):
        q = q.filter(Announcement.id.in_([int(i) for i in ids if str(i).isdigit()] or [-1]))
    seen = {aid for (aid,) in db.session.query(AnnouncementRead.announcement_id)
            .filter_by(employee_id=current_user.employee_id)}
    marked = 0
    for a in q:
        if a.id not in seen:
            db.session.add(AnnouncementRead(announcement_id=a.id, employee_id=current_user.employee_id, read_at=now()))
            marked += 1
    db.session.commit()
    return ok(marked=marked)


@bp.post("/announcements")
@permission_required("announcements")
def announcements_create():
    a = Announcement(author_id=current_user.id, author_name=current_user.name)
    _apply(a, request.form if request.form else body())
    db.session.add(a)
    _save_photos(a, request.files)
    if current_user.employee_id:  # the author has obviously seen it
        a.reads.append(AnnouncementRead(employee_id=current_user.employee_id))
    who = "everyone" if a.audience == "all" else ", ".join(e.full_name for e in a.recipients)[:200]
    audit(f"posted announcement “{a.title}”", "announcement", f"to {who}")
    db.session.commit()
    return ok(announcement=_ser(a)), 201


@bp.put("/announcements/<int:ann_id>")
@permission_required("announcements")
def announcements_update(ann_id):
    a = get_or_404(Announcement, ann_id, "Announcement")
    form = request.form if request.form else body()
    _apply(a, form)
    try:
        remove = {int(x) for x in json.loads(form.get("remove_photo_ids") or "[]")}
    except (TypeError, ValueError):
        remove = set()
    gone = [p for p in a.photos if p.id in remove]
    for p in gone:
        a.photos.remove(p)
    _save_photos(a, request.files)
    a.updated_at = now()
    audit(f"edited announcement “{a.title}”", "announcement")
    db.session.commit()
    for p in gone:
        delete_file(p.file_path)
    return ok(announcement=_ser(a))


@bp.delete("/announcements/<int:ann_id>")
@permission_required("announcements")
def announcements_delete(ann_id):
    a = get_or_404(Announcement, ann_id, "Announcement")
    paths, title = [p.file_path for p in a.photos], a.title
    db.session.delete(a)
    audit(f"deleted announcement “{title}”", "announcement")
    db.session.commit()
    for path in paths:
        delete_file(path)
    return ok(deleted=True)


@bp.get("/announcements/<int:ann_id>/readers")
@permission_required("announcements")
def announcements_readers(ann_id):
    a = get_or_404(Announcement, ann_id, "Announcement")
    reach = _audience_ids(a)
    when = {r.employee_id: r.read_at for r in a.reads}
    people = Employee.query.filter(Employee.id.in_(reach or {-1})).order_by(Employee.full_name).all()
    seen = [S.employee_brief(e) | {"read_at": S.iso(when[e.id])} for e in people if e.id in when]
    seen.sort(key=lambda p: p["read_at"], reverse=True)
    return ok(seen=seen, not_seen=[S.employee_brief(e) for e in people if e.id not in when])


def unread_count(user):
    """Used by the sidebar badge."""
    if not user.employee_id:
        return 0
    seen = db.session.query(AnnouncementRead.announcement_id).filter_by(employee_id=user.employee_id)
    mine = Announcement.recipients.any(Employee.id == user.employee_id)
    return (Announcement.query.filter(db.or_(Announcement.audience == "all", mine))
            .filter(~Announcement.id.in_(seen)).count())
