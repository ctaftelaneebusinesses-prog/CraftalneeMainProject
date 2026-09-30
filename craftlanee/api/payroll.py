"""Monthly payroll: create draft → edit → finalise (posts a Salary expense) → payslips."""
import re
from decimal import Decimal

from flask import request
from sqlalchemy import func, or_

from .. import pdf
from ..extensions import db
from ..models import Employee, Expense, Payroll, Payslip, now
from ..security import permission_required
from ..utils import (audit, clean, delete_file, get_settings, inr, month_bounds, month_label, new_rel_path,
                     next_doc_number, store_pdf, to_decimal)
from . import common as S
from .leaves import leave_days_in_month
from .common import bp, body, fail, get_or_404, ok

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
AMOUNTS = ("basic", "allowances", "deductions", "bonus")


def _month(month):
    if not MONTH_RE.match(month or ""):
        fail("Invalid month.", 404)
    return month


def month_payload(month):
    rows = Payroll.query.filter_by(month=month).join(Employee).order_by(Employee.full_name).all()
    included = {r.employee_id for r in rows}
    totals = {k: S.money(sum((Decimal(getattr(r, k) or 0) for r in rows), Decimal(0)))
              for k in AMOUNTS + ("net",)}
    return {
        "month": month, "label": month_label(month),
        "rows": [S.payroll_row(r) for r in rows],
        "totals": totals,
        "drafts": sum(1 for r in rows if r.status == "draft"),
        "finalized": sum(1 for r in rows if r.status == "finalized"),
        "missing_payslips": sum(1 for r in rows if r.status == "finalized" and r.payslip is None),
        "addable": [S.employee_brief(e) for e in Employee.query.order_by(Employee.full_name)
                    if e.id not in included],
        "expenses": [S.expense(x) for x in Expense.query.filter_by(payroll_month=month)],
    }


@bp.get("/payroll")
@permission_required("payroll")
def payroll_index():
    rows = (db.session.query(Payroll.month, func.count(Payroll.id), func.sum(Payroll.net),
                             func.sum(db.case((Payroll.status == "draft", 1), else_=0)))
            .group_by(Payroll.month).order_by(Payroll.month.desc()).all())
    slips = dict(db.session.query(Payslip.month, func.count(Payslip.id)).group_by(Payslip.month).all())
    months = [{"month": m, "label": month_label(m), "count": c, "total": S.money(t),
               "drafts": int(d or 0), "payslips": slips.get(m, 0)} for m, c, t, d in rows]
    active = Employee.query.filter_by(status="active").all()
    return ok(months=months, active_count=len(active),
              monthly_total=S.money(sum((Decimal(e.monthly_salary or 0) for e in active), Decimal(0))))


@bp.post("/payroll")
@permission_required("payroll")
def payroll_create():
    month = str(body().get("month") or "")
    if not MONTH_RE.match(month):
        fail("Please choose a valid month.")
    existing = {eid for (eid,) in db.session.query(Payroll.employee_id).filter_by(month=month)}
    added = 0
    for emp in Employee.query.filter_by(status="active"):
        if emp.id in existing:
            continue
        row = Payroll(employee_id=emp.id, month=month, basic=emp.monthly_salary or 0,
                      allowances=0, deductions=0, bonus=0)
        row.recalc()
        db.session.add(row)
        added += 1
    if not added and not existing:
        fail("There are no active employees to include.")
    if added:
        audit(f"created payroll for {month_label(month)}", "payroll", f"{added} employees")
    db.session.commit()
    return ok(month=month, added=added), 201


@bp.get("/payroll/<month>")
@permission_required("payroll")
def payroll_month(month):
    return ok(**month_payload(_month(month)))


@bp.put("/payroll/<month>")
@permission_required("payroll")
def payroll_save(month):
    """Body: {rows: [{id, basic, allowances, deductions, bonus, notes}]} — drafts only."""
    _month(month)
    incoming = {int(r["id"]): r for r in (body().get("rows") or []) if "id" in r}
    changed = False
    for row in Payroll.query.filter_by(month=month, status="draft"):
        data = incoming.get(row.id)
        if not data:
            continue
        for k in AMOUNTS:
            if k in data:
                v = to_decimal(data[k])
                if v < 0:
                    db.session.rollback()
                    fail(f"Amounts cannot be negative ({row.employee.full_name}).")
                if v != to_decimal(getattr(row, k)):
                    setattr(row, k, v)
                    changed = True
        if "notes" in data:
            note = clean(data, "notes", 255) or None
            if note != row.notes:
                row.notes, changed = note, True
        row.recalc()
    if changed:
        audit(f"updated payroll draft for {month_label(month)}", "payroll")
    db.session.commit()
    return ok(**month_payload(month))


@bp.post("/payroll/<month>/add")
@permission_required("payroll")
def payroll_add(month):
    _month(month)
    emp = get_or_404(Employee, int(body().get("employee_id") or 0), "Employee")
    if Payroll.query.filter_by(month=month, employee_id=emp.id).first():
        fail(f"{emp.full_name} is already in this payroll.")
    row = Payroll(employee_id=emp.id, month=month, basic=emp.monthly_salary or 0,
                  allowances=0, deductions=0, bonus=0)
    row.recalc()
    db.session.add(row)
    db.session.commit()
    return ok(**month_payload(month))


@bp.delete("/payroll/rows/<int:row_id>")
@permission_required("payroll")
def payroll_remove(row_id):
    row = get_or_404(Payroll, row_id, "Payroll row")
    if row.status != "draft":
        fail("Finalised payroll cannot be removed.")
    month = row.month
    db.session.delete(row)
    db.session.commit()
    return ok(**month_payload(month))


@bp.post("/payroll/<month>/finalize")
@permission_required("payroll")
def payroll_finalize(month):
    _month(month)
    drafts = (Payroll.query.filter_by(month=month, status="draft").join(Employee)
                  .order_by(Employee.full_name, Payroll.id).all())  # stable payslip numbering
    if not drafts:
        fail("Nothing to finalise — there are no draft rows.")
    for r in drafts:
        r.recalc()
    total = sum((to_decimal(r.net) for r in drafts), Decimal(0))
    n = len(drafts)
    expense = Expense(date=month_bounds(month)[1], category="Salary", amount=total,
                      payroll_month=month, paid_by="Company", payment_method="Bank Transfer",
                      description=f"Payroll — {month_label(month)} ({n} employee{'s' if n != 1 else ''})",
                      notes="Posted automatically when payroll was finalised.")
    db.session.add(expense)
    db.session.flush()
    stamp = now()
    for r in drafts:
        r.status, r.finalized_at, r.expense_id = "finalized", stamp, expense.id
    audit(f"finalised payroll for {month_label(month)}", "payroll", f"{inr(total)} posted to expenses")
    db.session.commit()
    generated = generate_slips(drafts) if body().get("generate_payslips", True) else 0
    return ok(**month_payload(month), posted=S.money(total), generated=generated)


@bp.post("/payroll/<month>/reopen")
@permission_required("payroll")
def payroll_reopen(month):
    """Undo finalisation: delete the posted Salary expense and the month's payslips, rows back to draft.

    This is how a payroll expense is "deleted" — the expense and the payroll it came from always
    change together, so the balance never disagrees with payroll.
    """
    _month(month)
    rows = Payroll.query.filter_by(month=month, status="finalized").all()
    expenses = Expense.query.filter_by(payroll_month=month).all()
    if not rows and not expenses:
        fail("This payroll isn't finalised.")
    files = []
    for r in rows:
        if r.payslip:
            files.append(r.payslip.file_path)
            db.session.delete(r.payslip)
        r.status, r.finalized_at, r.expense_id = "draft", None, None
    total = sum((to_decimal(x.amount) for x in expenses), Decimal(0))
    for x in expenses:
        db.session.delete(x)
    audit(f"reopened payroll for {month_label(month)}", "payroll",
          f"{inr(total)} salary expense and {len(files)} payslip(s) removed")
    db.session.commit()
    for path in files:
        delete_file(path)
    return ok(**month_payload(month), message=f"{month_label(month)} payroll is a draft again; "
                                              f"its {inr(total)} salary expense was removed.")


def generate_slips(rows, regenerate=False):
    settings = get_settings()
    count = 0
    for row in rows:
        if row.status != "finalized" or (row.payslip and not regenerate):
            continue
        slip = row.payslip
        if slip is None:
            slip = Payslip(number=next_doc_number(Payslip, "PS", int(row.month[:4])),
                           payroll_id=row.id, employee_id=row.employee_id, month=row.month,
                           file_path=new_rel_path("payslips", "pdf"))
            db.session.add(slip)
        slip.net = row.net
        db.session.flush()
        leave_days = leave_days_in_month(row.employee_id, row.month)
        store_pdf(slip.file_path, lambda target: pdf.payslip(slip, row, row.employee, settings, target,
                                                             leave_days=leave_days))
        audit(f"generated payslip {slip.number} for {row.employee.full_name}", "payroll")
        count += 1
    db.session.commit()
    return count


@bp.post("/payroll/<month>/payslips")
@permission_required("payroll")
def payroll_payslips(month):
    _month(month)
    rows = (Payroll.query.filter_by(month=month, status="finalized").join(Employee)
                .order_by(Employee.full_name, Payroll.id).all())  # stable payslip numbering
    n = generate_slips(rows, regenerate=bool(body().get("regenerate")))
    return ok(**month_payload(month), generated=n)


@bp.post("/payroll/rows/<int:row_id>/payslip")
@permission_required("payroll")
def payroll_row_payslip(row_id):
    row = get_or_404(Payroll, row_id, "Payroll row")
    if row.status != "finalized":
        fail("Finalise the payroll before generating a payslip.")
    generate_slips([row], regenerate=True)
    return ok(**month_payload(row.month))


@bp.get("/payslips")
@permission_required("payroll")
def payslips_list():
    q = clean(request.args, "q")
    month = request.args.get("month") or ""
    query = Payslip.query.join(Employee)
    if MONTH_RE.match(month):
        query = query.filter(Payslip.month == month)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Payslip.number.ilike(like), Employee.full_name.ilike(like),
                                 Employee.emp_code.ilike(like)))
    months = [m for (m,) in db.session.query(Payslip.month).distinct().order_by(Payslip.month.desc())]
    return ok(payslips=[S.payslip(p) for p in query.order_by(Payslip.month.desc(), Employee.full_name)],
              months=[{"month": m, "label": month_label(m)} for m in months])
