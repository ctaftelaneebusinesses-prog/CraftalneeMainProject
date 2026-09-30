"""Company settings, audit log, and the employee self-service portal."""
from flask import request
from flask_login import current_user

from ..defaults import (DEFAULT_INTERNSHIP_TERMS, DEFAULT_JOINING_BODY, DEFAULT_MOU_TERMS, DEFAULT_RELIEVING_BODY,
                        DEFAULT_OFFER_TERMS)
from ..extensions import db
from ..models import AuditLog, EmployeeDocument, JoiningLetter, OfferLetter, Payslip, RelievingLetter
from ..security import employee_required, permission_required
from ..richtext import sanitize_html
from ..utils import IMAGE_EXTS, audit, clean, delete_file, get_settings, parse_date, save_upload
from . import common as S
from .common import bp, fail, ok

TEXT = {"company_name": 160, "tagline": 200, "address": 1000, "phone": 40, "email": 160,
        "website": 160, "gstin": 30, "founder_name": 120, "founder_designation": 120}
RICH = ("offer_terms", "internship_terms", "joining_body", "relieving_body", "mou_terms")
IMAGES = ("logo", "signature", "letterhead")


@bp.get("/settings")
@permission_required("settings")
def settings_get():
    return ok(settings=S.company(get_settings(), full=True),
              defaults={"offer_terms": DEFAULT_OFFER_TERMS, "internship_terms": DEFAULT_INTERNSHIP_TERMS,
                        "joining_body": DEFAULT_JOINING_BODY, "relieving_body": DEFAULT_RELIEVING_BODY,
                        "mou_terms": DEFAULT_MOU_TERMS})


@bp.post("/settings")
@permission_required("settings")
def settings_save():
    s = get_settings()
    form = request.form
    for field, maxlen in TEXT.items():
        if field in form:
            setattr(s, field, clean(form, field, maxlen) or None)
    for field in RICH:
        if field in form:
            setattr(s, field, sanitize_html(form.get(field)) or None)
    if "show_name_with_logo" in form:
        s.show_name_with_logo = form.get("show_name_with_logo") in ("1", "true")
    s.company_name = s.company_name or "CraftLanee"
    s.gstin = s.gstin.upper() if s.gstin else None
    old_files = []
    for key in IMAGES:
        attr = f"{key}_path"
        upload = request.files.get(key)
        if upload and upload.filename:
            try:
                rel, _ = save_upload(upload, "company", IMAGE_EXTS)
            except ValueError as exc:
                db.session.rollback()
                fail(f"{key.title()}: {exc}")
            old_files.append(getattr(s, attr))
            setattr(s, attr, rel)
        elif form.get(f"remove_{key}") in ("1", "true"):
            old_files.append(getattr(s, attr))
            setattr(s, attr, None)
    audit("updated company settings", "settings")
    db.session.commit()
    for path in old_files:
        delete_file(path)
    return ok(settings=S.company(s, full=True))


@bp.get("/audit")
@permission_required("settings")
def audit_log():
    page = max(request.args.get("page", 1, type=int), 1)
    category = request.args.get("category", "")
    query = AuditLog.query
    if category:
        query = query.filter_by(category=category)
    per = 40
    logs = query.order_by(AuditLog.created_at.desc()).offset((page - 1) * per).limit(per + 1).all()
    return ok(entries=[S.audit_entry(a) for a in logs[:per]], page=page, has_next=len(logs) > per)


# ------------------------------------------------------------------ employee portal
# Fields an employee may change themselves. Everything else (salary, bank details, roles, department,
# employment type, joining date, reporting line, Employee ID, status) is admin-only.
SELF_EDITABLE = {"phone": 30, "email": 160, "address": 1000}
# Everything below is scoped to current_user.employee — no IDs are accepted from the client.

@bp.get("/me")
@employee_required
def me():
    emp = current_user.employee
    slips = Payslip.query.filter_by(employee_id=emp.id).order_by(Payslip.month.desc()).all()
    return ok(
        employee=S.employee_full(emp, include_bank=False),
        payslips=[S.payslip(p) | {"employee": None} for p in slips],
        documents={
            "offer": [S.offer_letter(l) for l in OfferLetter.query.filter_by(
                employee_id=emp.id, archived=False).order_by(OfferLetter.created_at.desc())],
            "joining": [S.joining_letter(l) for l in JoiningLetter.query.filter_by(
                employee_id=emp.id, archived=False).order_by(JoiningLetter.created_at.desc())],
            "relieving": [S.relieving_letter(l) for l in RelievingLetter.query.filter_by(
                employee_id=emp.id, archived=False).order_by(RelievingLetter.created_at.desc())],
            "other": [S.employee_document(d) for d in EmployeeDocument.query.filter_by(
                employee_id=emp.id, archived=False, visible_to_employee=True)
                .order_by(EmployeeDocument.created_at.desc())],
        },
        company=S.company(get_settings()),
    )


@bp.put("/me/profile")
@employee_required
def me_update():
    emp = current_user.employee
    form = request.form if request.form else (request.get_json(silent=True) or {})
    for field, maxlen in SELF_EDITABLE.items():
        if field in form:
            setattr(emp, field, clean(form, field, maxlen) or None)
    if "date_of_birth" in form:
        emp.date_of_birth = parse_date(form.get("date_of_birth"))
    emp.email = emp.email.lower() if emp.email else None
    old_photo = None
    photo = request.files.get("photo")
    if photo and photo.filename:
        try:
            rel, _ = save_upload(photo, "photos", IMAGE_EXTS)
        except ValueError as exc:
            fail(str(exc))
        old_photo, emp.photo_path = emp.photo_path, rel
    elif form.get("remove_photo") in ("1", "true"):
        old_photo, emp.photo_path = emp.photo_path, None
    audit("updated their own profile", "employee")
    db.session.commit()
    delete_file(old_photo)
    return ok(employee=S.employee_full(emp, include_bank=False), message="Profile updated.")
