"""Project documents: briefs, specs and files from project discussions, shared with everyone or chosen people.

The founder and admins with the "projects" area (e.g. the project manager) upload, share, edit and delete.
Everyone else sees the documents shared with them.
"""
import json
from urllib.parse import urlparse

from flask import request
from flask_login import current_user, login_required

from ..extensions import db
from ..models import Employee, ProjectDocument
from ..security import permission_required
from ..utils import DOC_EXTS, audit, clean, delete_file, save_upload
from . import common as S
from .announcements import SCHEME_RE
from .common import bp, body, fail, get_or_404, ok

PROJECT_EXTS = DOC_EXTS | {"ppt", "pptx", "csv", "zip"}


def _manager():
    return current_user.can("projects")


def _visible_query():
    q = ProjectDocument.query
    if _manager():
        return q
    if not current_user.employee_id:
        return q.filter(db.false())
    mine = ProjectDocument.recipients.any(Employee.id == current_user.employee_id)
    return q.filter(db.or_(ProjectDocument.audience == "all", mine))


def _ser(d):
    return {"id": d.id, "project": d.project, "title": d.title, "description": d.description, "link": d.link,
            "file_name": d.original_name, "file_url": S.file_url("project", d) if d.file_path else None,
            "audience": d.audience, "author_name": d.author_name,
            "recipients": [{"id": e.id, "full_name": e.full_name} for e in d.recipients] if d.audience == "selected" else [],
            "created_at": S.iso(d.created_at), "updated_at": S.iso(d.updated_at)}


def _link(raw):
    url = str(raw or "").strip()[:1000]
    if not url:
        return None
    scheme = SCHEME_RE.match(url)
    if scheme and scheme.group(1).lower() not in ("http", "https"):
        fail("The link must be a web address (https://…).")
    if "://" not in url:
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        fail("The link must be a web address (https://…).")
    return url


def _apply(d, form, files):
    d.project = clean(form, "project", 160)
    d.title = clean(form, "title", 200)
    d.description = clean(form, "description", 10000) or None
    d.link = _link(form.get("link"))
    if not d.project:
        fail("Which project is this for?")
    if not d.title:
        fail("Give the document a title.")
    d.audience = "selected" if form.get("audience") == "selected" else "all"
    if d.audience == "selected":
        raw = form.get("recipient_ids") or "[]"
        try:
            ids = {int(x) for x in (json.loads(raw) if isinstance(raw, str) else raw)}
        except (TypeError, ValueError):
            fail("Choose who should see this.")
        people = Employee.query.filter(Employee.id.in_(ids or {-1})).all()
        if not people:
            fail("Choose at least one person, or share it with everyone.")
        d.recipients = people
    else:
        d.recipients = []
    upload = files.get("file")
    replaced = None
    if upload and upload.filename:
        try:
            rel, original = save_upload(upload, "projects", PROJECT_EXTS)
        except ValueError as exc:
            fail(str(exc))
        replaced, d.file_path, d.original_name = d.file_path, rel, original
    elif str(form.get("remove_file", "")).lower() in ("1", "true") and d.file_path:
        replaced, d.file_path, d.original_name = d.file_path, None, None
    if not d.file_path and not d.link:
        fail("Attach a file or add a link.")
    return replaced


@bp.get("/projects")
@login_required
def projects_list():
    rows = _visible_query().order_by(ProjectDocument.created_at.desc()).limit(500).all()
    projects = sorted({d.project for d in rows}, key=str.lower)
    return ok(documents=[_ser(d) for d in rows], projects=projects, can_manage=_manager())


@bp.post("/projects")
@permission_required("projects")
def projects_create():
    d = ProjectDocument(author_id=current_user.id, author_name=current_user.name)
    try:
        _apply(d, body(), request.files)
    except Exception:
        db.session.rollback()
        if d.file_path:
            delete_file(d.file_path)
        raise
    db.session.add(d)
    db.session.flush()
    who = "everyone" if d.audience == "all" else f"{len(d.recipients)} people"
    audit(f"shared project document “{d.title}”", "document", f"{d.project} · {who}")
    db.session.commit()
    return ok(document=_ser(d)), 201


@bp.post("/projects/<int:doc_id>")
@permission_required("projects")
def projects_update(doc_id):
    d = get_or_404(ProjectDocument, doc_id, "Document")
    replaced = _apply(d, body(), request.files)
    audit(f"updated project document “{d.title}”", "document", d.project)
    db.session.commit()
    delete_file(replaced)
    return ok(document=_ser(d))


@bp.delete("/projects/<int:doc_id>")
@permission_required("projects")
def projects_delete(doc_id):
    d = get_or_404(ProjectDocument, doc_id, "Document")
    path = d.file_path
    audit(f"deleted project document “{d.title}”", "document", d.project)
    db.session.delete(d)
    db.session.commit()
    delete_file(path)
    return ok(deleted=True)
