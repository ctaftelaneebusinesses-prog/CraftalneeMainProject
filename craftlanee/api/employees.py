import json
import secrets
from collections import Counter

from flask import request
from sqlalchemy import or_

from ..extensions import db
from ..models import (ALL_PERMISSIONS, EMPLOYMENT_TYPES, FIXED_TERM_TYPES, PERMISSIONS, ROLE_EMPLOYEE, Employee,
                      EmployeeDocument, User)
from flask_login import current_user, login_required

from ..security import founder_required, owner_required, permission_required
from ..utils import (IMAGE_EXTS, audit, clean, delete_file, get_settings, inr, next_emp_code, next_emp_codes,
                     parse_date, save_upload, to_decimal)
from . import common as S
from .common import bp, body, fail, fail_if, get_or_404, ok

TEXT_FIELDS = {
    "full_name": 120, "phone": 30, "email": 160, "address": 1000,
    "department": 120, "employment_type": 30, "work_location": 120, "reporting_person": 120,
    "bank_name": 120, "bank_account_name": 120, "bank_account_number": 40, "bank_ifsc": 20,
}
DATE_FIELDS = ("date_of_birth", "joining_date", "salary_effective_date", "end_date")


def parse_roles(value):
    """Roles arrive as a JSON array (React) or a comma-separated string."""
    if isinstance(value, list):
        return value
    text = str(value or "").strip()
    if text.startswith("["):
        try:
            data = json.loads(text)
            return data if isinstance(data, list) else []
        except ValueError:
            return []
    return [r for r in text.split(",") if r.strip()]


def descendants(emp_id):
    """IDs of everyone reporting (directly or indirectly) to emp_id."""
    children = {}
    for eid, mid in db.session.query(Employee.id, Employee.manager_id):
        children.setdefault(mid, []).append(eid)
    out, stack = set(), [emp_id]
    while stack:
        for c in children.get(stack.pop(), []):
            if c not in out:
                out.add(c)
                stack.append(c)
    return out


def is_self(emp):
    return (not current_user.is_founder) and current_user.employee_id == emp.id


def guard_admin_target(emp):
    """Only the founder can act on another admin's account."""
    if emp.user and emp.user.is_admin and not current_user.is_founder and not is_self(emp):
        fail("Only the founder can change another admin's account.", 403)


def _apply(emp, form, files):
    errors = []
    for field, maxlen in TEXT_FIELDS.items():
        setattr(emp, field, clean(form, field, maxlen) or None)
    for field in DATE_FIELDS:
        setattr(emp, field, parse_date(form.get(field)))
    if "roles" in form or "designation" in form:
        roles = parse_roles(form.get("roles")) or ([form.get("designation")] if form.get("designation") else [])
        emp.set_roles(roles)
    manager_raw = form.get("manager_id")
    if manager_raw not in (None, ""):
        try:
            manager_id = int(manager_raw)
        except (TypeError, ValueError):
            manager_id = None
        if manager_id and (manager_id == emp.id or (emp.id and manager_id in descendants(emp.id))):
            errors.append("Reporting line would create a loop — choose someone who doesn't report to this employee.")
        else:
            manager = db.session.get(Employee, manager_id) if manager_id else None
            emp.manager_id = manager.id if manager else None
            if manager:
                emp.reporting_person = manager.full_name
    elif "manager_id" in form:
        emp.manager_id = None
    if emp.employment_type not in FIXED_TERM_TYPES:
        emp.end_date = None
    elif emp.end_date and emp.joining_date and emp.end_date < emp.joining_date:
        errors.append("End date cannot be before the joining date.")
    emp.email = emp.email.lower() if emp.email else None
    emp.bank_ifsc = emp.bank_ifsc.upper() if emp.bank_ifsc else None
    if emp.employment_type not in EMPLOYMENT_TYPES:
        emp.employment_type = "Full-time"
    code = clean(form, "emp_code", 30).upper()
    if code:
        clash = Employee.query.filter(Employee.emp_code == code, Employee.id != (emp.id or 0)).first()
        if clash:
            errors.append(f"Employee ID {code} is already used by {clash.full_name}.")
        else:
            emp.emp_code = code
    elif not emp.emp_code:
        emp.emp_code = next_emp_code(emp.employment_type)
    salary = to_decimal(form.get("monthly_salary"))
    if salary < 0:
        errors.append("Monthly salary cannot be negative.")
    emp.monthly_salary = salary
    if not emp.full_name:
        errors.append("Full name is required.")
    photo = files.get("photo")
    if photo and photo.filename and not errors:
        try:
            rel, _ = save_upload(photo, "photos", IMAGE_EXTS)
            emp._replaced_photo = emp.photo_path
            emp.photo_path = rel
        except ValueError as exc:
            errors.append(str(exc))
    if form.get("remove_photo") in ("1", "true", True) and not (photo and photo.filename):
        emp._replaced_photo, emp.photo_path = emp.photo_path, None
    return errors


def profile(emp):
    return S.employee_full(emp) | {
        "login": S.login_info(emp.user),
        "offer_letters": [S.offer_letter(l) for l in emp.offer_letters],
        "joining_letters": [S.joining_letter(l) for l in emp.joining_letters],
        "relieving_letters": [S.relieving_letter(l) for l in emp.relieving_letters],
        "payslips": [S.payslip(p) | {"employee": None} for p in emp.payslips],
        "documents": [S.employee_document(d) for d in emp.documents],
        "payroll": [S.payroll_row(r) | {"employee": None} for r in emp.payroll_entries],
        "reports": [S.employee_brief(r) for r in
                    Employee.query.filter_by(manager_id=emp.id).order_by(Employee.status, Employee.full_name)],
    }


@bp.get("/employees")
@permission_required("employees")
def employees_list():
    q = clean(request.args, "q")
    status = request.args.get("status", "all")
    etype = request.args.get("type", "")
    role = clean(request.args, "role")
    query = Employee.query
    if etype in EMPLOYMENT_TYPES:
        query = query.filter_by(employment_type=etype)
    if role:
        query = query.filter(or_(Employee.roles.ilike(f'%"{role}"%'), Employee.designation == role))
    if status in ("active", "inactive"):
        query = query.filter_by(status=status)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Employee.full_name.ilike(like), Employee.emp_code.ilike(like),
                                 Employee.designation.ilike(like), Employee.department.ilike(like),
                                 Employee.email.ilike(like), Employee.phone.ilike(like)))
    rows = query.order_by(Employee.full_name).all()
    counts = {"active": Employee.query.filter_by(status="active").count(),
              "inactive": Employee.query.filter_by(status="inactive").count()}
    counts["all"] = counts["active"] + counts["inactive"]
    active = Employee.query.filter_by(status="active").all()
    by_type = Counter(e.employment_type or "Full-time" for e in active)
    by_role = Counter(r for e in active for r in e.role_list)
    return ok(employees=[S.employee_brief(e) for e in rows], counts=counts, next_code=next_emp_code(),
              next_codes=next_emp_codes(),
              by_type=[{"type": t, "count": by_type.get(t, 0)} for t in EMPLOYMENT_TYPES],
              by_role=[{"role": r, "count": c} for r, c in by_role.most_common()],
              multi_role=sum(1 for e in active if len(e.role_list) > 1))


@bp.post("/employees")
@permission_required("employees")
def employees_create():
    emp = Employee(employment_type="Full-time", monthly_salary=0)
    fail_if(_apply(emp, body(), request.files))
    db.session.add(emp)
    db.session.flush()
    audit(f"created employee {emp.full_name} ({emp.emp_code})", "employee")
    db.session.commit()
    return ok(employee=profile(emp)), 201


@bp.get("/employees/<int:emp_id>")
@permission_required("employees")
def employees_get(emp_id):
    return ok(employee=profile(get_or_404(Employee, emp_id, "Employee")))


@bp.put("/employees/<int:emp_id>")
@permission_required("employees")
def employees_update(emp_id):
    emp = get_or_404(Employee, emp_id, "Employee")
    guard_admin_target(emp)
    old_salary = to_decimal(emp.monthly_salary)
    errors = _apply(emp, body(), request.files)
    if is_self(emp):  # admins cannot raise their own salary
        emp.monthly_salary = old_salary
    if errors:
        db.session.rollback()
        fail_if(errors)
    audit(f"updated employee {emp.full_name} ({emp.emp_code})", "employee")
    if to_decimal(emp.monthly_salary) != old_salary:
        audit(f"updated salary of {emp.full_name}", "employee",
              f"{inr(old_salary)} → {inr(emp.monthly_salary)}")
    if emp.user:
        emp.user.name = emp.full_name
    db.session.commit()
    delete_file(getattr(emp, "_replaced_photo", None))
    return ok(employee=profile(emp))


@bp.post("/employees/<int:emp_id>/toggle-status")
@permission_required("employees")
def employees_toggle(emp_id):
    emp = get_or_404(Employee, emp_id, "Employee")
    if is_self(emp):
        fail("You can't deactivate your own account.", 403)
    guard_admin_target(emp)
    emp.status = "inactive" if emp.is_active else "active"
    verb = "reactivated" if emp.is_active else "deactivated"
    audit(f"{verb} employee {emp.full_name}", "employee")
    db.session.commit()
    return ok(employee=profile(emp), message=f"{emp.full_name} has been {verb}.")


@bp.delete("/employees/<int:emp_id>")
@permission_required("employees")
def employees_delete(emp_id):
    emp = get_or_404(Employee, emp_id, "Employee")
    if is_self(emp):
        fail("You can't delete your own account.", 403)
    guard_admin_target(emp)
    if clean(body(), "confirm_code").upper() != emp.emp_code.upper():
        fail("Type the Employee ID exactly to confirm deletion.")
    paths = [emp.photo_path] + [d.file_path for d in emp.documents] \
        + [l.file_path for l in emp.offer_letters] + [l.file_path for l in emp.joining_letters] \
        + [l.file_path for l in emp.relieving_letters] \
        + [p.file_path for p in emp.payslips]
    name, code = emp.full_name, emp.emp_code
    db.session.delete(emp)
    audit(f"deleted employee {name} ({code})", "employee")
    db.session.commit()
    for p in paths:
        delete_file(p)
    return ok(message=f"{name} and all their records were deleted.")


# ------------------------------------------------------------------ login access

@bp.post("/employees/<int:emp_id>/login")
@permission_required("employees")
def employees_login(emp_id):
    emp = get_or_404(Employee, emp_id, "Employee")
    guard_admin_target(emp)
    data = body()
    action = data.get("action", "save")
    user = emp.user
    if action in ("disable", "enable"):
        if not user:
            fail("This employee has no login yet.")
        user.active = action == "enable"
        audit(f"{action}d login for {emp.full_name}", "employee")
        db.session.commit()
        return ok(employee=profile(emp), message=f"Login {action}d.")

    email = clean(data, "email", 160).lower() or (emp.email or "")
    password = str(data.get("password") or "")
    generated = not password
    if generated:
        password = secrets.token_urlsafe(8)
    if "@" not in email:
        fail("A valid email is required for login.")
    if len(password) < 8:
        fail("Password must be at least 8 characters.")
    if User.query.filter(User.email == email, User.id != (user.id if user else 0)).first():
        fail("That email is already used by another login.")
    if user is None:
        user = User(name=emp.full_name, email=email, role=ROLE_EMPLOYEE, employee=emp)
        db.session.add(user)
        audit(f"created login for {emp.full_name}", "employee")
    else:
        user.email = email
        user.active = True
        audit(f"reset login password for {emp.full_name}", "employee")
    user.set_password(password)
    db.session.commit()
    return ok(employee=profile(emp), temp_password=password if generated else None,
              message=f"Login ready for {email}.")


# ------------------------------------------------------------------ other documents

@bp.post("/employees/<int:emp_id>/documents")
@permission_required("employees")
def employees_upload(emp_id):
    emp = get_or_404(Employee, emp_id, "Employee")
    form = request.form
    try:
        rel, original = save_upload(request.files.get("file"), "employee_docs")
    except ValueError as exc:
        fail(str(exc))
    if not rel:
        fail("Please choose a file to upload.")
    doc = EmployeeDocument(employee=emp, title=clean(form, "title", 160) or original, file_path=rel,
                           original_name=original, notes=clean(form, "notes", 1000) or None,
                           visible_to_employee=form.get("visible", "1") in ("1", "true"))
    db.session.add(doc)
    audit(f"uploaded document '{doc.title}' for {emp.full_name}", "document")
    db.session.commit()
    return ok(document=S.employee_document(doc)), 201


@bp.post("/employee-documents/<int:doc_id>/<action>")
@permission_required("employees")
def employee_document_action(doc_id, action):
    doc = get_or_404(EmployeeDocument, doc_id, "Document")
    if action == "archive":
        doc.archived = not doc.archived
        audit(f"{'archived' if doc.archived else 'restored'} document '{doc.title}'", "document")
    elif action == "visibility":
        doc.visible_to_employee = not doc.visible_to_employee
    elif action == "delete":
        delete_file(doc.file_path)
        audit(f"deleted document '{doc.title}'", "document")
        db.session.delete(doc)
        db.session.commit()
        return ok(deleted=True)
    else:
        fail("Unknown action.", 404)
    db.session.commit()
    return ok(document=S.employee_document(doc))


@bp.get("/employees/options")
@founder_required
def employees_options():
    """Lightweight list for pickers (letters, payroll, reporting person)."""
    rows = Employee.query.order_by(Employee.status, Employee.full_name).all()
    return ok(employees=[S.employee_brief(e) for e in rows])


@bp.post("/employees/<int:emp_id>/reports")
@login_required
def employees_reports(emp_id):
    """Put several people (e.g. a batch of interns) under one employee, or move them back to the founder.

    Body: {"add": [ids], "remove": [ids]}. Open to admins with Employees or Team access.
    """
    if not (current_user.can("employees") or current_user.can("team")):
        fail("Not allowed.", 403)
    manager = get_or_404(Employee, emp_id, "Employee")
    data = body()

    def ids(key):
        try:
            return {int(x) for x in (data.get(key) or [])}
        except (TypeError, ValueError):
            fail("Invalid employee list.")

    add, remove = ids("add"), ids("remove")
    if not add and not remove:
        fail("Choose at least one person.")
    people = {e.id: e for e in Employee.query.filter(Employee.id.in_(add | remove))}
    if len(people) != len(add | remove):
        fail("One of the selected people no longer exists.", 404)
    above = {manager.id}  # the manager and everyone above them: none of these can report to the manager
    m = manager
    while m.manager_id and m.manager_id not in above:
        above.add(m.manager_id)
        m = db.session.get(Employee, m.manager_id)
    loops = [people[i].full_name for i in add if i in above]
    if loops:
        fail(f"{', '.join(loops)} can't report to {manager.full_name} — that would create a loop in the reporting line.")
    moved = []
    for i in add:
        e = people[i]
        if e.manager_id != manager.id:
            e.manager_id, e.reporting_person = manager.id, manager.full_name
            moved.append(e.full_name)
    founder = get_settings().founder_name
    freed = []
    for i in remove - add:
        e = people[i]
        if e.manager_id == manager.id:
            e.manager_id, e.reporting_person = None, founder
            freed.append(e.full_name)
    if moved:
        audit(f"put {len(moved)} {'person' if len(moved) == 1 else 'people'} under {manager.full_name}", "employee",
              ", ".join(moved))
    if freed:
        audit(f"moved {', '.join(freed)} from {manager.full_name} to the founder", "employee")
    db.session.commit()
    parts = []
    if moved:
        parts.append(f"{len(moved)} now report{'s' if len(moved) == 1 else ''} to {manager.full_name}")
    if freed:
        parts.append(f"{len(freed)} moved to the founder")
    return ok(employee=profile(manager) if current_user.can("employees") else None,
              message="; ".join(parts) + "." if parts else "Nothing changed.")


@bp.get("/permissions")
@owner_required
def permissions_list():
    """The console areas the founder can grant, in display order."""
    return ok(permissions=[{"key": k, "label": label, "description": desc}
                           for k, (label, desc) in PERMISSIONS.items()])


@bp.post("/employees/<int:emp_id>/admin")
@owner_required
def employees_admin(emp_id):
    """Founder chooses which console areas an employee may use (requires a login).

    Body: {"permissions": ["payroll", "leaves", ...]}. An empty list revokes access.
    The older {"grant": true|false} form still works and means everything / nothing.
    """
    emp = get_or_404(Employee, emp_id, "Employee")
    if not emp.user:
        fail("Create a portal login for this employee first.")
    data = body()
    if "permissions" in data:
        chosen = data.get("permissions")
        if not isinstance(chosen, list):
            chosen = parse_roles(chosen)
        unknown = [p for p in chosen if p not in PERMISSIONS]
        if unknown:
            fail(f"Unknown access area: {', '.join(map(str, unknown))}.")
    else:
        chosen = ALL_PERMISSIONS if data.get("grant") else []
    before = emp.user.perms
    emp.user.set_perms(chosen)
    after = emp.user.perms
    if after == before:
        return ok(employee=profile(emp), message="No changes to access.")
    labels = lambda keys: ", ".join(PERMISSIONS[k][0] for k in ALL_PERMISSIONS if k in keys) or "none"
    if not after:
        audit(f"revoked admin access for {emp.full_name}", "employee", f"was: {labels(before)}")
        message = f"Admin access revoked for {emp.full_name}."
    else:
        audit(f"{'granted' if not before else 'changed'} admin access for {emp.full_name}", "employee",
              f"{labels(before)} → {labels(after)}")
        message = f"Access updated for {emp.full_name}."
    db.session.commit()
    return ok(employee=profile(emp), message=message)
