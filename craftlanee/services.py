"""Read-side calculations shared by the dashboard and finance pages."""
from decimal import Decimal

from sqlalchemy import case, func

from .extensions import db
from .models import STIPEND_TYPES, Employee, Expense, Income


def _between(q, col, start, end):
    if start:
        q = q.filter(col >= start)
    if end:
        q = q.filter(col <= end)
    return q


def _dec(value):
    return Decimal(value or 0)


def finance_totals(start=None, end=None):
    """Balance = received income − all expenses (finalised payroll is posted as a Salary expense).

    Two queries (conditional sums) — every round trip matters when the database is remote.
    """
    is_received = Income.payment_status == "Received"
    received, pending = _between(db.session.query(
        func.sum(case((is_received, Income.amount), else_=0)),
        func.sum(case((is_received, 0), else_=Income.amount))), Income.date, start, end).one()
    expenses, payroll = _between(db.session.query(
        func.sum(Expense.amount),
        func.sum(case((Expense.payroll_month.isnot(None), Expense.amount), else_=0))), Expense.date, start, end).one()
    received, pending, expenses, payroll = map(_dec, (received, pending, expenses, payroll))
    return {
        "income": received,
        "pending_income": pending,
        "expenses": expenses,
        "payroll": payroll,
        "other_expenses": expenses - payroll,
        "balance": received - expenses,
    }


def monthly_totals(start, end):
    """{(year, month): (received income, expenses)} for the range — two grouped queries for any number of months."""
    out = {}
    y, m = func.extract("year", Income.date), func.extract("month", Income.date)
    for yy, mm, amount in (_between(db.session.query(y, m, func.sum(Income.amount)), Income.date, start, end)
                           .filter(Income.payment_status == "Received").group_by(y, m)):
        out[(int(yy), int(mm))] = [_dec(amount), Decimal(0)]
    y, m = func.extract("year", Expense.date), func.extract("month", Expense.date)
    for yy, mm, amount in _between(db.session.query(y, m, func.sum(Expense.amount)), Expense.date, start, end).group_by(y, m):
        out.setdefault((int(yy), int(mm)), [Decimal(0), Decimal(0)])[1] = _dec(amount)
    return out


def expenses_by_category(start=None, end=None):
    q = _between(db.session.query(Expense.category, func.sum(Expense.amount)),
                 Expense.date, start, end)
    rows = q.group_by(Expense.category).order_by(func.sum(Expense.amount).desc()).all()
    return [(c, Decimal(a or 0)) for c, a in rows]


def headcount():
    """People on the books, with interns & trainees (stipend types) counted apart from employees."""
    active = Employee.status == "active"
    intern = Employee.employment_type.in_(sorted(STIPEND_TYPES))
    active_emp, active_int = active & ~intern, active & intern
    total, active_n, monthly, emp_total, emp_active, int_total, int_active, salaries, stipends = db.session.query(
        func.count(Employee.id), func.sum(case((active, 1), else_=0)),
        func.sum(case((active, Employee.monthly_salary), else_=0)),
        func.sum(case((intern, 0), else_=1)), func.sum(case((active_emp, 1), else_=0)),
        func.sum(case((intern, 1), else_=0)), func.sum(case((active_int, 1), else_=0)),
        func.sum(case((active_emp, Employee.monthly_salary), else_=0)),
        func.sum(case((active_int, Employee.monthly_salary), else_=0))).one()
    return {"total": total, "active": int(active_n or 0), "monthly_payroll": _dec(monthly),
            "employees_total": int(emp_total or 0), "employees_active": int(emp_active or 0),
            "interns_total": int(int_total or 0), "interns_active": int(int_active or 0),
            "salaries": _dec(salaries), "stipends": _dec(stipends)}
