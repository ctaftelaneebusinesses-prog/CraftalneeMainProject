"""Income, expenses, balance, dashboard and global search."""
from datetime import date, datetime
from decimal import Decimal

from flask import request
from flask_login import current_user
from sqlalchemy import or_

from ..extensions import db
from ..models import (EXPENSE_CATEGORIES, INCOME_STATUSES, PAYMENT_METHODS, AuditLog, Employee,
                      Expense, Income, Payroll)
from ..security import can_view_document, founder_required, permission_required
from ..services import expenses_by_category, finance_totals, headcount
from ..utils import (audit, clean, delete_file, inr, month_bounds, parse_date, period_range,
                     save_upload, to_decimal)
from . import common as S
from .common import bp, body, fail, fail_if, get_or_404, iso, ok
from .documents import collect


def _totals(t):
    return {k: S.money(v) for k, v in t.items()}


def _period():
    period = request.args.get("period", "all")
    label, s, e = period_range(period, request.args.get("start"), request.args.get("end"))
    return {"period": period, "label": label, "start": iso(s), "end": iso(e)}, s, e


def _dates(query, col, s, e):
    if s:
        query = query.filter(col >= s)
    if e:
        query = query.filter(col <= e)
    return query


def _last_months(n=6):
    today = date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def trend(n=6):
    series = []
    for month in _last_months(n):
        s, e = month_bounds(month)
        t = finance_totals(s, e)
        series.append({"month": month, "label": datetime.strptime(month, "%Y-%m").strftime("%b"),
                       "income": S.money(t["income"]), "expenses": S.money(t["expenses"]),
                       "balance": S.money(t["balance"])})
    return series


@bp.get("/meta")
@founder_required
def meta():
    from ..models import EMPLOYMENT_TYPES, FIXED_TERM_TYPES, LEAVE_TYPES, STIPEND_TYPES, TASK_PRIORITIES
    return ok(employment_types=EMPLOYMENT_TYPES, fixed_term_types=sorted(FIXED_TERM_TYPES),
              stipend_types=sorted(STIPEND_TYPES), leave_types=LEAVE_TYPES, task_priorities=TASK_PRIORITIES,
              expense_categories=EXPENSE_CATEGORIES, payment_methods=PAYMENT_METHODS,
              income_statuses=INCOME_STATUSES)


@bp.get("/dashboard")
@founder_required
def dashboard():
    drafts = [m for (m,) in db.session.query(Payroll.month).filter_by(status="draft")
              .distinct().order_by(Payroll.month.desc())]
    this_label, s, e = period_range("this_month")
    departments = {}
    for emp in Employee.query.filter_by(status="active"):
        key = emp.department or "Unassigned"
        departments[key] = departments.get(key, 0) + 1
    recent = Employee.query.order_by(Employee.created_at.desc()).limit(5).all()
    from collections import Counter
    from ..models import EMPLOYMENT_TYPES, Leave, Task
    active = Employee.query.filter_by(status="active").all()
    by_type = Counter(e.employment_type or "Full-time" for e in active)
    by_role = Counter(r for e in active for r in e.role_list)
    today = date.today()
    on_leave = (Leave.query.join(Employee).filter(Leave.status == "approved", Employee.status == "active",
                                                  Leave.start_date <= today, Leave.end_date >= today).all())
    task_counts = Counter(t.status for t in Task.query)
    recent_done = Task.query.filter_by(status="done").order_by(Task.completed_at.desc()).limit(5).all()
    can = current_user.can
    people = {k: (S.money(v) if isinstance(v, Decimal) else v) for k, v in headcount().items()}
    if not (can("employees") or can("payroll")):
        people["monthly_payroll"] = None
    finance = can("finance")
    return ok(
        areas=sorted(current_user.perms),
        people=people,
        totals=_totals(finance_totals()) if finance else None,
        this_month=(_totals(finance_totals(s, e)) | {"label": this_label}) if finance else None,
        trend=trend(6) if finance else [],
        categories=[{"category": c, "amount": S.money(a)} for c, a in expenses_by_category(s, e)] if finance else [],
        departments=[{"name": k, "count": v} for k, v in sorted(departments.items(), key=lambda x: -x[1])],
        recent_employees=[S.employee_brief(x) for x in recent] if can("employees") else [],
        activity=[S.audit_entry(a) for a in AuditLog.query.order_by(AuditLog.created_at.desc()).limit(10)]
        if can("settings") else [],
        draft_months=drafts if can("payroll") else [],
        by_type=[{"type": t, "count": by_type.get(t, 0)} for t in EMPLOYMENT_TYPES if by_type.get(t)],
        by_role=[{"role": r, "count": c} for r, c in by_role.most_common(8)],
        multi_role=sum(1 for e in active if len(e.role_list) > 1),
        on_leave_today=[S.leave(l, private=False) for l in on_leave],
        pending_leaves=Leave.query.filter_by(status="pending").count() if can("leaves") else 0,
        tasks={"todo": task_counts.get("todo", 0), "in_progress": task_counts.get("in_progress", 0),
               "done": task_counts.get("done", 0)},
        recent_done=[S.task(t) for t in recent_done] if can("team") else [],
    )


@bp.get("/finance/summary")
@permission_required("finance")
def finance_summary():
    sel, s, e = _period()
    return ok(
        period=sel, overall=_totals(finance_totals()), totals=_totals(finance_totals(s, e)),
        categories=[{"category": c, "amount": S.money(a)} for c, a in expenses_by_category(s, e)],
        trend=trend(12),
        recent_income=[S.income(r) for r in _dates(Income.query, Income.date, s, e)
                       .order_by(Income.date.desc(), Income.id.desc()).limit(6)],
        recent_expenses=[S.expense(r) for r in _dates(Expense.query, Expense.date, s, e)
                         .order_by(Expense.date.desc(), Expense.id.desc()).limit(6)],
    )


# ------------------------------------------------------------------ income

def _apply_income(row, d):
    row.date = parse_date(d.get("date")) or date.today()
    row.source = clean(d, "source", 160)
    row.client = clean(d, "client", 160) or None
    row.description = clean(d, "description", 2000) or None
    row.amount = to_decimal(d.get("amount"))
    row.payment_status = d.get("payment_status") if d.get("payment_status") in INCOME_STATUSES else "Received"
    row.notes = clean(d, "notes", 2000) or None
    errors = []
    if not row.source:
        errors.append("Source is required.")
    if row.amount <= 0:
        errors.append("Amount must be greater than zero.")
    return errors


@bp.get("/income")
@permission_required("finance")
def income_list():
    sel, s, e = _period()
    q, status = clean(request.args, "q"), request.args.get("status", "")
    query = _dates(Income.query, Income.date, s, e)
    if status in INCOME_STATUSES:
        query = query.filter_by(payment_status=status)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Income.source.ilike(like), Income.client.ilike(like),
                                 Income.description.ilike(like), Income.notes.ilike(like)))
    rows = query.order_by(Income.date.desc(), Income.id.desc()).all()
    total = sum((Decimal(r.amount) for r in rows), Decimal(0))
    received = sum((Decimal(r.amount) for r in rows if r.payment_status == "Received"), Decimal(0))
    return ok(rows=[S.income(r) for r in rows], period=sel, total=S.money(total),
              received=S.money(received), pending=S.money(total - received))


@bp.post("/income")
@permission_required("finance")
def income_create():
    row = Income()
    fail_if(_apply_income(row, body()))
    db.session.add(row)
    db.session.flush()
    audit("added income", "finance", f"{row.code} · {row.source} · {inr(row.amount)}")
    db.session.commit()
    return ok(row=S.income(row)), 201


@bp.put("/income/<int:row_id>")
@permission_required("finance")
def income_update(row_id):
    row = get_or_404(Income, row_id, "Income")
    if row.invoice:
        fail(f"This income comes from invoice {row.invoice.number}. Change the invoice instead.", 409)
    errors = _apply_income(row, body())
    if errors:
        db.session.rollback()
        fail_if(errors)
    audit("updated income", "finance", f"{row.code} · {row.source} · {inr(row.amount)}")
    db.session.commit()
    return ok(row=S.income(row))


@bp.delete("/income/<int:row_id>")
@permission_required("finance")
def income_delete(row_id):
    row = get_or_404(Income, row_id, "Income")
    if row.invoice:
        fail(f"This income comes from invoice {row.invoice.number}. Mark the invoice unpaid instead.", 409)
    audit("deleted income", "finance", f"{row.code} · {row.source} · {inr(row.amount)}")
    db.session.delete(row)
    db.session.commit()
    return ok(deleted=True)


# ------------------------------------------------------------------ expenses

def _apply_expense(row, d, files):
    row.date = parse_date(d.get("date")) or date.today()
    row.category = d.get("category") if d.get("category") in EXPENSE_CATEGORIES else "Other"
    row.description = clean(d, "description", 2000)
    row.amount = to_decimal(d.get("amount"))
    row.paid_by = clean(d, "paid_by", 120) or None
    row.payment_method = d.get("payment_method") if d.get("payment_method") in PAYMENT_METHODS else None
    row.notes = clean(d, "notes", 2000) or None
    errors = []
    if not row.description:
        errors.append("Description is required.")
    if row.amount <= 0:
        errors.append("Amount must be greater than zero.")
    receipt = files.get("receipt")
    if not errors and receipt and receipt.filename:
        try:
            rel, original = save_upload(receipt, "receipts")
            row._replaced_receipt = row.receipt_path
            row.receipt_path, row.receipt_name = rel, original
        except ValueError as exc:
            errors.append(str(exc))
    elif not errors and d.get("remove_receipt") in ("1", "true") and row.receipt_path:
        row._replaced_receipt, row.receipt_path, row.receipt_name = row.receipt_path, None, None
    return errors


@bp.get("/expenses")
@permission_required("finance")
def expenses_list():
    sel, s, e = _period()
    q, category = clean(request.args, "q"), request.args.get("category", "")
    query = _dates(Expense.query, Expense.date, s, e)
    if category in EXPENSE_CATEGORIES:
        query = query.filter_by(category=category)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Expense.description.ilike(like), Expense.paid_by.ilike(like),
                                 Expense.notes.ilike(like), Expense.category.ilike(like)))
    rows = query.order_by(Expense.date.desc(), Expense.id.desc()).all()
    total = sum((Decimal(r.amount) for r in rows), Decimal(0))
    payroll = sum((Decimal(r.amount) for r in rows if r.is_payroll), Decimal(0))
    return ok(rows=[S.expense(r) for r in rows], period=sel, total=S.money(total),
              payroll=S.money(payroll), other=S.money(total - payroll))


@bp.post("/expenses")
@permission_required("finance")
def expenses_create():
    row = Expense()
    fail_if(_apply_expense(row, body(), request.files))
    db.session.add(row)
    db.session.flush()
    audit("added expense", "finance", f"{row.code} · {row.category} · {inr(row.amount)}")
    db.session.commit()
    return ok(row=S.expense(row)), 201


@bp.put("/expenses/<int:row_id>")
@permission_required("finance")
def expenses_update(row_id):
    row = get_or_404(Expense, row_id, "Expense")
    if row.is_payroll:
        fail("Payroll expenses are created automatically and cannot be edited.", 409)
    errors = _apply_expense(row, body(), request.files)
    if errors:
        db.session.rollback()
        fail_if(errors)
    audit("updated expense", "finance", f"{row.code} · {row.category} · {inr(row.amount)}")
    db.session.commit()
    delete_file(getattr(row, "_replaced_receipt", None))
    return ok(row=S.expense(row))


@bp.delete("/expenses/<int:row_id>")
@permission_required("finance")
def expenses_delete(row_id):
    row = get_or_404(Expense, row_id, "Expense")
    if row.is_payroll:
        fail("This expense was posted by payroll. Reopen that payroll month to remove it.", 409)
    audit("deleted expense", "finance", f"{row.code} · {row.category} · {inr(row.amount)}")
    path = row.receipt_path
    db.session.delete(row)
    db.session.commit()
    delete_file(path)
    return ok(deleted=True)


# ------------------------------------------------------------------ search

@bp.get("/search")
@founder_required
def search():
    q = clean(request.args, "q", 100)
    empty = {"employees": [], "documents": [], "income": [], "expenses": []}
    if len(q) < 2:
        return ok(q=q, results=empty)
    like = f"%{q}%"
    employees = Employee.query.filter(or_(
        Employee.full_name.ilike(like), Employee.emp_code.ilike(like), Employee.email.ilike(like),
        Employee.phone.ilike(like), Employee.designation.ilike(like), Employee.department.ilike(like),
    )).order_by(Employee.full_name).limit(8).all()
    income_q = or_(Income.source.ilike(like), Income.client.ilike(like), Income.description.ilike(like))
    expense_q = or_(Expense.description.ilike(like), Expense.category.ilike(like),
                    Expense.paid_by.ilike(like))
    code = q.upper()
    if code.startswith("INC-") and code[4:].isdigit():
        income_q = or_(income_q, Income.id == int(code[4:]))
    if code.startswith("EXP-") and code[4:].isdigit():
        expense_q = or_(expense_q, Expense.id == int(code[4:]))
    can = current_user.can
    docs = [d for d in collect("all", q, archived=False) if can_view_document(d["kind"])][:10]
    return ok(q=q, results={
        "employees": [S.employee_brief(e) for e in employees] if can("employees") else [],
        "documents": docs,
        "income": [S.income(r) for r in Income.query.filter(income_q).order_by(Income.date.desc()).limit(6)]
        if can("finance") else [],
        "expenses": [S.expense(r) for r in Expense.query.filter(expense_q).order_by(Expense.date.desc()).limit(6)]
        if can("finance") else [],
    })
