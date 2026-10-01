"""JSON API plumbing: blueprint, errors, request body, serialisers."""
from decimal import Decimal

from flask import Blueprint, jsonify, request
from flask_login import current_user

from ..extensions import db

bp = Blueprint("api", __name__, url_prefix="/api")


class ApiError(Exception):
    def __init__(self, message, status=400, errors=None):
        super().__init__(message)
        self.message, self.status, self.errors = message, status, errors or []


@bp.errorhandler(ApiError)
def _api_error(err):
    return jsonify(error=err.message, errors=err.errors), err.status


def fail(message, status=400, errors=None):
    raise ApiError(message, status, errors)


def fail_if(errors):
    if errors:
        raise ApiError(errors[0], 400, errors)


def body():
    """JSON body or multipart form, whichever was sent."""
    if request.is_json:
        return request.get_json(silent=True) or {}
    return request.form


def get_or_404(model, obj_id, label="Record"):
    obj = db.session.get(model, obj_id)
    if obj is None:
        raise ApiError(f"{label} not found.", 404)
    return obj


def ok(**data):
    return jsonify(data)


# ------------------------------------------------------------------ serialisers

def money(value):
    return float(Decimal(value or 0))


def iso(value):
    return value.isoformat() if value else None


def _v(obj):
    """Cache-buster for file URLs so replaced images/PDFs refresh in the browser."""
    return int(obj.updated_at.timestamp()) if getattr(obj, "updated_at", None) else 0


def file_url(kind, obj):
    return f"/files/{kind}/{obj.id}?v={_v(obj)}"


SALARY_AREAS = ("employees", "payroll", "documents")  # letters are pre-filled with the salary


def _may_see_salary(e):
    user = current_user
    if not user or not user.is_authenticated:
        return False
    return user.employee_id == e.id or any(user.can(p) for p in SALARY_AREAS)


def employee_brief(e):
    admin = e.user if e.user and e.user.active else None
    return {
        "id": e.id, "emp_code": e.emp_code, "full_name": e.full_name, "initials": e.initials,
        "designation": e.designation, "department": e.department, "email": e.email, "phone": e.phone,
        "joining_date": iso(e.joining_date), "employment_type": e.employment_type,
        "monthly_salary": money(e.monthly_salary) if _may_see_salary(e) else None, "status": e.status,
        "photo_url": file_url("photo", e) if e.photo_path else None,
        "roles": e.role_list, "manager_id": e.manager_id, "end_date": iso(e.end_date),
        "is_admin": bool(admin and admin.has_admin),
        "full_access": bool(admin and admin.has_admin and admin.full_access),
    }


def employee_full(e, include_bank=True):
    data = employee_brief(e) | {
        "date_of_birth": iso(e.date_of_birth), "address": e.address,
        "work_location": e.work_location, "reporting_person": e.reporting_person,
        "salary_effective_date": iso(e.salary_effective_date),
        "manager": ({"id": e.manager.id, "full_name": e.manager.full_name} if e.manager else None),
        "created_at": iso(e.created_at),
        "college": e.college, "study_department": e.study_department,
        "experience_level": e.experience_level,
        "experience_years": float(e.experience_years) if e.experience_years is not None else None,
        "previous_company": e.previous_company,
        "resume_name": e.resume_name, "resume_url": file_url("resume", e) if e.resume_path else None,
    }
    if include_bank:
        data |= {"bank_name": e.bank_name, "bank_account_name": e.bank_account_name,
                 "bank_account_number": e.bank_account_number, "bank_ifsc": e.bank_ifsc}
    else:
        data |= {"bank_name": e.bank_name, "bank_account_masked": e.masked_account,
                 "bank_ifsc": e.bank_ifsc}
    return data


def login_info(user):
    if user is None:
        return None
    return {"email": user.email, "active": user.active, "is_admin": user.has_admin,
            "permissions": sorted(user.perms), "last_login_at": iso(user.last_login_at)}


def offer_letter(l):
    return {"id": l.id, "kind": "offer", "number": l.number, "employee_id": l.employee_id,
            "employee_name": l.employee.full_name if l.employee else l.candidate_name,
            "emp_code": l.employee.emp_code if l.employee else None,
            "letter_date": iso(l.letter_date), "candidate_name": l.candidate_name, "address": l.address,
            "designation": l.designation, "department": l.department, "joining_date": iso(l.joining_date),
            "salary": money(l.salary), "employment_type": l.employment_type,
            "work_location": l.work_location, "reporting_person": l.reporting_person,
            "end_date": iso(l.end_date), "letter_type": l.letter_type or "employment",
            "pay_basis": l.pay_basis or "stipend", "working_hours": l.working_hours, "work_days": l.work_days,
            "probation_period": l.probation_period, "notice_period": l.notice_period,
            "commission_percent": float(l.commission_percent) if l.commission_percent is not None else None,
            "intro": l.intro, "terms": l.terms,
            "archived": l.archived, "created_at": iso(l.created_at),
            "file_url": file_url("offer", l)}


def joining_letter(l):
    return {"id": l.id, "kind": "joining", "number": l.number, "employee_id": l.employee_id,
            "employee_name": l.employee.full_name if l.employee else l.employee_name,
            "letter_date": iso(l.letter_date), "emp_code": l.emp_code,
            "designation": l.designation, "department": l.department, "joining_date": iso(l.joining_date),
            "salary": money(l.salary), "reporting_person": l.reporting_person, "body": l.body,
            "employment_type": l.employment_type, "work_location": l.work_location,
            "working_hours": l.working_hours, "work_days": l.work_days, "probation_period": l.probation_period,
            "archived": l.archived, "created_at": iso(l.created_at),
            "file_url": file_url("joining", l)}


def relieving_letter(l):
    return {"id": l.id, "kind": "relieving", "number": l.number, "employee_id": l.employee_id,
            "employee_name": l.employee.full_name if l.employee else l.employee_name,
            "letter_date": iso(l.letter_date), "emp_code": l.emp_code, "designation": l.designation,
            "department": l.department, "employment_type": l.employment_type,
            "joining_date": iso(l.joining_date), "resignation_date": iso(l.resignation_date),
            "last_working_day": iso(l.last_working_day), "salary": 0, "body": l.body,
            "archived": l.archived, "created_at": iso(l.created_at), "file_url": file_url("relieving", l)}


def mou(m):
    return {"id": m.id, "number": m.number, "party_name": m.party_name,
            "contact_person": m.contact_person, "address": m.address,
            "start_date": iso(m.start_date), "end_date": iso(m.end_date), "purpose": m.purpose,
            "scope": m.scope, "payment_terms": m.payment_terms, "responsibilities": m.responsibilities,
            "terms": m.terms, "signatory": m.signatory, "signatory_designation": m.signatory_designation,
            "archived": m.archived, "created_at": iso(m.created_at), "updated_at": iso(m.updated_at),
            "file_url": file_url("mou", m)}


def payslip(p):
    return {"id": p.id, "number": p.number, "month": p.month, "net": money(p.net),
            "employee_id": p.employee_id,
            "employee": employee_brief(p.employee) if p.employee else None,
            "created_at": iso(p.created_at), "updated_at": iso(p.updated_at),
            "file_url": file_url("payslip", p)}


def payroll_row(r):
    return {"id": r.id, "month": r.month, "employee": employee_brief(r.employee),
            "basic": money(r.basic), "allowances": money(r.allowances),
            "deductions": money(r.deductions), "bonus": money(r.bonus), "net": money(r.net),
            "notes": r.notes, "status": r.status, "finalized_at": iso(r.finalized_at),
            "payslip": ({"id": r.payslip.id, "number": r.payslip.number,
                         "file_url": file_url("payslip", r.payslip)} if r.payslip else None)}


def employee_document(d):
    return {"id": d.id, "employee_id": d.employee_id, "title": d.title, "notes": d.notes,
            "original_name": d.original_name, "visible_to_employee": d.visible_to_employee,
            "archived": d.archived, "created_at": iso(d.created_at), "file_url": file_url("doc", d)}


def income(r):
    return {"id": r.id, "code": r.code, "date": iso(r.date), "source": r.source, "client": r.client,
            "description": r.description, "amount": money(r.amount),
            "payment_status": r.payment_status, "notes": r.notes, "created_at": iso(r.created_at),
            "invoice": {"id": r.invoice.id, "number": r.invoice.number} if r.invoice else None}


def invoice(i):
    return {"id": i.id, "number": i.number, "client_name": i.client_name, "client_address": i.client_address,
            "client_email": i.client_email, "client_phone": i.client_phone, "client_gstin": i.client_gstin,
            "invoice_date": iso(i.invoice_date), "due_date": iso(i.due_date),
            "items": [{"description": l["description"], "qty": float(l["qty"]), "rate": money(l["rate"]),
                       "amount": money(l["amount"])} for l in i.lines],
            "tax_label": i.tax_label, "tax_rate": float(i.tax_rate or 0), "discount": money(i.discount),
            "subtotal": money(i.subtotal), "tax_amount": money(i.tax_amount), "total": money(i.total),
            "notes": i.notes, "terms": i.terms, "status": i.status, "overdue": i.is_overdue,
            "paid_date": iso(i.paid_date), "payment_method": i.payment_method,
            "income": {"id": i.income.id, "code": i.income.code} if i.income else None,
            "created_at": iso(i.created_at), "updated_at": iso(i.updated_at),
            "file_url": file_url("invoice", i) if i.file_path else None}


def expense(r):
    return {"id": r.id, "code": r.code, "date": iso(r.date), "category": r.category,
            "description": r.description, "amount": money(r.amount), "paid_by": r.paid_by,
            "payment_method": r.payment_method, "notes": r.notes, "payroll_month": r.payroll_month,
            "is_payroll": r.is_payroll, "receipt_name": r.receipt_name,
            "receipt_url": file_url("receipt", r) if r.receipt_path else None,
            "created_at": iso(r.created_at)}


def audit_entry(a):
    return {"id": a.id, "user_name": a.user_name, "action": a.action, "category": a.category,
            "details": a.details, "created_at": iso(a.created_at)}


def company(s, full=False):
    data = {"company_name": s.company_name, "tagline": s.tagline,
            "logo_url": file_url("logo", s) if s.logo_path else None}
    if full:
        data |= {"address": s.address, "phone": s.phone, "email": s.email, "website": s.website,
                 "gstin": s.gstin, "founder_name": s.founder_name,
                 "founder_designation": s.founder_designation,
                 "hr_name": s.hr_name, "hr_designation": s.hr_designation,
                 "offer_terms": s.offer_terms, "internship_terms": s.internship_terms,
                 "joining_body": s.joining_body, "relieving_body": s.relieving_body, "mou_terms": s.mou_terms,
                 "work_hours": s.work_hours, "work_days": s.work_days, "probation_period": s.probation_period,
                 "notice_period": s.notice_period,
                 "show_name_with_logo": bool(s.show_name_with_logo),
                 "signature_url": file_url("signature", s) if s.signature_path else None,
                 "hr_signature_url": file_url("hr_signature", s) if s.hr_signature_path else None,
                 "letterhead_url": file_url("letterhead", s) if s.letterhead_path else None}
    return data


def leave(l, private=True):
    data = {"id": l.id, "employee": employee_brief(l.employee), "leave_type": l.leave_type,
            "start_date": iso(l.start_date), "end_date": iso(l.end_date), "half_day": l.half_day,
            "days": l.days, "status": l.status, "source": l.source, "created_at": iso(l.created_at)}
    if private:
        data |= {"reason": l.reason, "decided_by": l.decided_by, "decided_at": iso(l.decided_at),
                 "decision_note": l.decision_note}
    return data


def holiday(h):
    return {"id": h.id, "date": iso(h.date), "name": h.name}


def task(t):
    return {"id": t.id, "title": t.title, "description": t.description,
            "assignee": employee_brief(t.assignee), "created_by_id": t.created_by_id,
            "created_by_name": t.created_by_name, "due_date": iso(t.due_date), "priority": t.priority,
            "status": t.status, "completed_at": iso(t.completed_at), "created_at": iso(t.created_at),
            "updated_at": iso(t.updated_at),
            "items_total": len(t.items), "items_done": sum(1 for i in t.items if i.done), "notes_count": len(t.notes)}


def task_item(i):
    return {"id": i.id, "title": i.title, "done": i.done, "done_at": iso(i.done_at),
            "created_by_name": i.created_by_name, "created_at": iso(i.created_at)}


def task_note(n):
    return {"id": n.id, "body": n.body, "author_id": n.author_id, "author_name": n.author_name,
            "created_at": iso(n.created_at)}
