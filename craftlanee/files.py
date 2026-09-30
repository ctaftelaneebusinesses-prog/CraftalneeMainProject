"""The only way stored files leave the server. Every request is authorised here.

Founder: any file. Admins: the files of the console areas the founder granted them
(see security.KIND_AREAS). Employee: only their own photo, letters, payslips and documents
the founder marked visible — never archived items, MOUs, receipts or company assets —
plus photos on announcements addressed to them.
"""
import io
import mimetypes
import os

from flask import Blueprint, abort, request, send_file
from flask_login import current_user, login_required

from .extensions import db
from .models import (AnnouncementPhoto, CompanySettings, Employee, EmployeeDocument, Expense, Invoice,
                     JoiningLetter, Mou, OfferLetter, Payslip, RelievingLetter)
from .security import can_view_document
from .utils import read_file

bp = Blueprint("files", __name__, url_prefix="/files")

EMPLOYEE_KINDS = {"offer", "joining", "relieving", "payslip", "doc", "photo", "resume"}


def _resolve(kind, obj_id):
    """Return (record, rel_path, download_name, owner_employee_id)."""
    if kind == "offer":
        r = db.session.get(OfferLetter, obj_id)
        return r, r and r.file_path, r and f"{r.number}.pdf", r and r.employee_id
    if kind == "joining":
        r = db.session.get(JoiningLetter, obj_id)
        return r, r and r.file_path, r and f"{r.number}.pdf", r and r.employee_id
    if kind == "relieving":
        r = db.session.get(RelievingLetter, obj_id)
        return r, r and r.file_path, r and f"{r.number}.pdf", r and r.employee_id
    if kind == "payslip":
        r = db.session.get(Payslip, obj_id)
        return r, r and r.file_path, r and f"{r.number}.pdf", r and r.employee_id
    if kind == "doc":
        r = db.session.get(EmployeeDocument, obj_id)
        return r, r and r.file_path, r and (r.original_name or r.title), r and r.employee_id
    if kind == "resume":
        r = db.session.get(Employee, obj_id)
        return r, r and r.resume_path, r and (r.resume_name or f"{r.emp_code}-resume"), r and r.id
    if kind == "photo":
        r = db.session.get(Employee, obj_id)
        return r, r and r.photo_path, None, r and r.id
    if kind == "mou":
        r = db.session.get(Mou, obj_id)
        return r, r and r.file_path, r and f"{r.number}.pdf", None
    if kind == "announcement":
        r = db.session.get(AnnouncementPhoto, obj_id)
        return r, r and r.file_path, r and r.original_name, None
    if kind == "invoice":
        r = db.session.get(Invoice, obj_id)
        return r, r and r.file_path, r and f"{r.number}.pdf", None
    if kind == "receipt":
        r = db.session.get(Expense, obj_id)
        return r, r and r.receipt_path, r and (r.receipt_name or f"{r.code}-receipt"), None
    if kind in ("logo", "signature", "hr_signature", "letterhead"):
        r = CompanySettings.query.first()
        return r, r and getattr(r, f"{kind}_path"), None, None
    abort(404)


def _employee_may_access(kind, record, owner_id):
    me = current_user.employee_id
    if kind not in EMPLOYEE_KINDS or owner_id is None or owner_id != me:
        return False
    if getattr(record, "archived", False):
        return False
    if kind == "doc" and not record.visible_to_employee:
        return False
    return True


@bp.route("/<kind>/<int:obj_id>")
@login_required
def serve(kind, obj_id):
    record, rel, name, owner = _resolve(kind, obj_id)
    if record is None or not rel:
        abort(404)
    # Logos and active colleagues' photos are visible to every signed-in user (sidebar, team tree).
    public = (kind == "logo" or (kind == "photo" and getattr(record, "status", "") == "active")
              or (kind == "announcement" and record.announcement.visible_to(current_user.employee_id)))
    if not public and not can_view_document(kind) and not _employee_may_access(kind, record, owner):
        abort(404)  # don't reveal that the record exists
    data = read_file(rel)
    if data is None:
        abort(404)
    filename = os.path.basename(rel)
    response = send_file(io.BytesIO(data), mimetype=mimetypes.guess_type(filename)[0] or "application/octet-stream",
                         as_attachment=request.args.get("dl") == "1", download_name=name or filename, max_age=0)
    response.headers["Cache-Control"] = "private, no-store"
    return response
