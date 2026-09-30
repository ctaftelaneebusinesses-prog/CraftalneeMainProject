"""Read-side calculations shared by the dashboard and finance pages."""
from decimal import Decimal

from sqlalchemy import func

from .extensions import db
from .models import Employee, Expense, Income


def _sum(query):
    return Decimal(query.scalar() or 0)


def _between(q, col, start, end):
    if start:
        q = q.filter(col >= start)
    if end:
        q = q.filter(col <= end)
    return q


def finance_totals(start=None, end=None):
    """Balance = received income − all expenses (finalised payroll is posted as a Salary expense)."""
    inc = _between(db.session.query(func.sum(Income.amount)), Income.date, start, end)
    exp = _between(db.session.query(func.sum(Expense.amount)), Expense.date, start, end)
    received = _sum(inc.filter(Income.payment_status == "Received"))
    pending = _sum(inc.filter(Income.payment_status != "Received"))
    expenses = _sum(exp)
    payroll = _sum(exp.filter(Expense.payroll_month.isnot(None)))
    return {
        "income": received,
        "pending_income": pending,
        "expenses": expenses,
        "payroll": payroll,
        "other_expenses": expenses - payroll,
        "balance": received - expenses,
    }


def expenses_by_category(start=None, end=None):
    q = _between(db.session.query(Expense.category, func.sum(Expense.amount)),
                 Expense.date, start, end)
    rows = q.group_by(Expense.category).order_by(func.sum(Expense.amount).desc()).all()
    return [(c, Decimal(a or 0)) for c, a in rows]


def headcount():
    total = Employee.query.count()
    active = Employee.query.filter_by(status="active").count()
    monthly = _sum(db.session.query(func.sum(Employee.monthly_salary))
                   .filter(Employee.status == "active"))
    return {"total": total, "active": active, "monthly_payroll": monthly}
