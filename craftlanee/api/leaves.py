"""Leave requests, approvals, the shared team calendar, holidays and Excel/CSV import.

Visibility: every signed-in user sees the calendar (who is on approved leave + holidays),
but reasons and decision notes are only returned to admins and to the employee themselves.
Approvals: founder and admins (never on their own request).
"""
import calendar
import csv
import io
from datetime import date, datetime, timedelta

from flask import request, send_file
from flask_login import current_user, login_required

from ..extensions import db
from ..models import LEAVE_TYPES, Employee, Holiday, Leave, now
from ..security import employee_required, permission_required
from ..utils import audit, clean, parse_date
from . import common as S
from .common import bp, body, fail, get_or_404, iso, ok

MAX_SPAN_DAYS = 90


def count_days(start, end, half_day=False, holidays=None):
    """Working days between two dates (Sundays and company holidays excluded)."""
    if half_day:
        return 0.5
    holidays = holidays if holidays is not None else {h.date for h in Holiday.query.filter(
        Holiday.date >= start, Holiday.date <= end)}
    days, d = 0, start
    while d <= end:
        if d.weekday() != 6 and d not in holidays:
            days += 1
        d += timedelta(days=1)
    return float(days)


def leave_days_in_month(employee_id, month):
    """Approved leave days falling in a YYYY-MM month (used on payslips)."""
    y, m = (int(x) for x in month.split("-"))
    start, end = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    total = 0.0
    for l in Leave.query.filter(Leave.employee_id == employee_id, Leave.status == "approved",
                                Leave.start_date <= end, Leave.end_date >= start):
        if l.half_day:
            total += 0.5
        else:
            total += count_days(max(l.start_date, start), min(l.end_date, end))
    return total


def _validate(start, end, half_day):
    if not start or not end:
        fail("Please choose the leave dates.")
    if end < start:
        fail("End date cannot be before the start date.")
    if (end - start).days > MAX_SPAN_DAYS:
        fail(f"A single leave can't span more than {MAX_SPAN_DAYS} days.")
    if half_day and start != end:
        fail("A half day must start and end on the same date.")


def _overlaps(employee_id, start, end, exclude_id=None):
    q = Leave.query.filter(Leave.employee_id == employee_id, Leave.status.in_(("pending", "approved")),
                           Leave.start_date <= end, Leave.end_date >= start)
    if exclude_id:
        q = q.filter(Leave.id != exclude_id)
    return q.first()


def _can_see_private(leave):
    return current_user.can("leaves") or current_user.employee_id == leave.employee_id


# ------------------------------------------------------------------ calendar (everyone)

@bp.get("/leaves/calendar")
@login_required
def leaves_calendar():
    month = request.args.get("month") or date.today().strftime("%Y-%m")
    try:
        y, m = (int(x) for x in month.split("-"))
        start = date(y, m, 1)
    except (ValueError, TypeError):
        fail("Invalid month.")
    end = date(y, m, calendar.monthrange(y, m)[1])
    nxt_start = end + timedelta(days=1)
    nxt_end = date(nxt_start.year, nxt_start.month, calendar.monthrange(nxt_start.year, nxt_start.month)[1])
    rows = (Leave.query.join(Employee).filter(Leave.status == "approved", Employee.status == "active",
                                              Leave.start_date <= end, Leave.end_date >= start)
            .order_by(Leave.start_date).all())
    next_count = (Leave.query.join(Employee).filter(Leave.status == "approved", Employee.status == "active",
                                                    Leave.start_date <= nxt_end, Leave.end_date >= nxt_start).count())
    today = date.today()
    on_leave_today = [S.employee_brief(l.employee) for l in rows if l.start_date <= today <= l.end_date]
    return ok(month=month, leaves=[S.leave(l, private=_can_see_private(l)) for l in rows],
              holidays=[S.holiday(h) for h in Holiday.query.filter(Holiday.date >= start, Holiday.date <= end)
                        .order_by(Holiday.date)],
              summary={"this_month": len(rows), "next_month": next_count,
                       "people_this_month": len({l.employee_id for l in rows}),
                       "on_leave_today": on_leave_today},
              types=LEAVE_TYPES)


@bp.get("/holidays")
@login_required
def holidays_list():
    year = request.args.get("year", type=int) or date.today().year
    rows = Holiday.query.filter(Holiday.date >= date(year, 1, 1), Holiday.date <= date(year, 12, 31)).order_by(Holiday.date)
    return ok(holidays=[S.holiday(h) for h in rows])


# ------------------------------------------------------------------ my leaves (employee)

@bp.get("/leaves/mine")
@employee_required
def leaves_mine():
    emp = current_user.employee
    rows = Leave.query.filter_by(employee_id=emp.id).order_by(Leave.start_date.desc()).all()
    year = date.today().year
    taken = sum(l.days for l in rows if l.status == "approved" and l.start_date.year == year)
    pending = sum(1 for l in rows if l.status == "pending")
    return ok(leaves=[S.leave(l) for l in rows], taken_this_year=taken, pending=pending, types=LEAVE_TYPES)


@bp.post("/leaves")
@login_required
def leaves_create():
    """Employees request leave for themselves; admins may add an approved leave for anyone."""
    d = body()
    start, end = parse_date(d.get("start_date")), parse_date(d.get("end_date"))
    half_day = str(d.get("half_day", "")).lower() in ("1", "true")
    _validate(start, end, half_day)
    leave_type = d.get("leave_type") if d.get("leave_type") in LEAVE_TYPES else "Other"
    target_id = d.get("employee_id")
    admin_entry = current_user.can("leaves") and target_id and int(target_id) != (current_user.employee_id or 0)
    if admin_entry:
        emp = get_or_404(Employee, int(target_id), "Employee")
    else:
        if not current_user.employee:
            fail("Only employees can request leave.", 403)
        emp = current_user.employee
    if _overlaps(emp.id, start, end):
        fail("These dates overlap another pending or approved leave.")
    leave = Leave(employee_id=emp.id, leave_type=leave_type, start_date=start, end_date=end, half_day=half_day,
                  days=count_days(start, end, half_day), reason=clean(d, "reason", 1000) or None)
    if admin_entry:
        leave.status, leave.source = "approved", "admin"
        leave.decided_by, leave.decided_at = current_user.name, now()
        audit(f"added {leave_type.lower()} leave for {emp.full_name}", "leave", f"{start} → {end}")
    else:
        leave.status, leave.source = "pending", "request"
        audit(f"requested {leave_type.lower()} leave", "leave", f"{start} → {end} · {leave.days:g} day(s)")
    db.session.add(leave)
    db.session.commit()
    return ok(leave=S.leave(leave)), 201


@bp.post("/leaves/<int:leave_id>/cancel")
@login_required
def leaves_cancel(leave_id):
    leave = get_or_404(Leave, leave_id, "Leave")
    mine = current_user.employee_id == leave.employee_id
    if not (mine or current_user.can("leaves")):
        fail("Not allowed.", 403)
    if mine and not current_user.can("leaves") and leave.status != "pending":
        fail("Only pending requests can be cancelled. Ask an admin to cancel an approved leave.")
    leave.status = "cancelled"
    audit(f"cancelled leave of {leave.employee.full_name}", "leave", f"{leave.start_date} → {leave.end_date}")
    db.session.commit()
    return ok(leave=S.leave(leave))


# ------------------------------------------------------------------ approvals (admins)

@bp.get("/leaves")
@permission_required("leaves")
def leaves_admin_list():
    status = request.args.get("status", "pending")
    q = Leave.query.join(Employee)
    if status in ("pending", "approved", "rejected", "cancelled"):
        q = q.filter(Leave.status == status)
    emp_id = request.args.get("employee_id", type=int)
    if emp_id:
        q = q.filter(Leave.employee_id == emp_id)
    rows = q.order_by(Leave.start_date.desc() if status != "pending" else Leave.created_at).limit(300).all()
    return ok(leaves=[S.leave(l) for l in rows],
              pending=Leave.query.filter_by(status="pending").count())


@bp.post("/leaves/<int:leave_id>/decide")
@permission_required("leaves")
def leaves_decide(leave_id):
    leave = get_or_404(Leave, leave_id, "Leave")
    if leave.employee_id == current_user.employee_id and not current_user.is_founder:
        fail("You can't approve your own leave — the founder or another admin must decide.", 403)
    decision = body().get("decision")
    if decision not in ("approve", "reject"):
        fail("Decision must be approve or reject.")
    if leave.status not in ("pending", "approved", "rejected"):
        fail("This request can no longer be changed.")
    if decision == "approve" and _overlaps(leave.employee_id, leave.start_date, leave.end_date, exclude_id=leave.id):
        fail("This overlaps another approved or pending leave for the same person.")
    leave.status = "approved" if decision == "approve" else "rejected"
    leave.decided_by, leave.decided_at = current_user.name, now()
    leave.decision_note = clean(body(), "note", 255) or None
    audit(f"{leave.status} leave for {leave.employee.full_name}", "leave",
          f"{leave.start_date} → {leave.end_date} · {leave.days:g} day(s)")
    db.session.commit()
    return ok(leave=S.leave(leave))


@bp.delete("/leaves/<int:leave_id>")
@permission_required("leaves")
def leaves_delete(leave_id):
    leave = get_or_404(Leave, leave_id, "Leave")
    audit(f"deleted leave record of {leave.employee.full_name}", "leave", f"{leave.start_date} → {leave.end_date}")
    db.session.delete(leave)
    db.session.commit()
    return ok(deleted=True)


# ------------------------------------------------------------------ holidays (admins)

@bp.post("/holidays")
@permission_required("leaves")
def holidays_create():
    d = body()
    day, name = parse_date(d.get("date")), clean(d, "name", 120)
    if not day or not name:
        fail("Holiday date and name are required.")
    if Holiday.query.filter_by(date=day).first():
        fail("A holiday already exists on that date.")
    h = Holiday(date=day, name=name)
    db.session.add(h)
    audit(f"added holiday {name}", "leave", str(day))
    db.session.commit()
    return ok(holiday=S.holiday(h)), 201


@bp.delete("/holidays/<int:holiday_id>")
@permission_required("leaves")
def holidays_delete(holiday_id):
    h = get_or_404(Holiday, holiday_id, "Holiday")
    db.session.delete(h)
    db.session.commit()
    return ok(deleted=True)


# ------------------------------------------------------------------ Excel / CSV import

TEMPLATE_HEADERS = ["Employee ID", "From (YYYY-MM-DD)", "To (YYYY-MM-DD)", "Type", "Half day (Y/N)", "Reason / Holiday name"]


def _cell_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    text = str(v or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _read_rows(upload):
    name = (upload.filename or "").lower()
    data = upload.read()
    if len(data) > 5 * 1024 * 1024:
        fail("Import files are limited to 5 MB.")
    if name.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        return list(csv.reader(io.StringIO(text)))
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        return [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)]
    fail("Please upload an .xlsx or .csv file (use the template).")


@bp.get("/leaves/template")
@permission_required("leaves")
def leaves_template():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Leaves"
    ws.append(TEMPLATE_HEADERS)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="5B3FE0")
    first = Employee.query.filter_by(status="active").order_by(Employee.emp_code).first()
    code = first.emp_code if first else "CL-EMP-0001"
    today = date.today()
    ws.append([code, today.isoformat(), (today + timedelta(days=1)).isoformat(), "Casual", "N", "Family function"])
    ws.append(["", date(today.year, 12, 25).isoformat(), "", "Holiday", "", "Christmas"])
    for col, w in zip("ABCDEF", (16, 20, 20, 16, 15, 32)):
        ws.column_dimensions[col].width = w
    notes = wb.create_sheet("How to fill")
    for line in ["Leave rows: Employee ID + From + To + Type (" + ", ".join(LEAVE_TYPES) + ").",
                 "Company holidays: leave Employee ID empty (or ALL), set Type to Holiday and the name in the last column.",
                 "Imported leaves are added as APPROVED and appear on everyone's calendar immediately.",
                 "Dates: YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY."]:
        notes.append([line])
    notes.column_dimensions["A"].width = 110
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="craftlanee-leave-import-template.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@bp.post("/leaves/import")
@permission_required("leaves")
def leaves_import():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        fail("Choose a file to import.")
    rows = _read_rows(upload)
    if not rows:
        fail("The file is empty.")
    header = [str(c or "").strip().lower() for c in rows[0]]
    start_row = 1 if header and ("employee" in header[0] or "from" in " ".join(header)) else 0
    codes = {e.emp_code.upper(): e for e in Employee.query.all()}
    existing_holidays = {h.date for h in Holiday.query.all()}
    added_leaves, added_holidays, errors = 0, 0, []
    for i, raw in enumerate(rows[start_row:], start=start_row + 1):
        cells = list(raw) + [None] * 6
        code, start_v, end_v, typ, half, reason = cells[:6]
        if not any(str(c or "").strip() for c in cells[:6]):
            continue
        start, end = _cell_date(start_v), _cell_date(end_v) or _cell_date(start_v)
        typ = str(typ or "").strip()
        code = str(code or "").strip().upper()
        if not start:
            errors.append({"row": i, "error": "Missing or invalid From date."})
            continue
        if typ.lower() == "holiday" or code in ("", "ALL"):
            name = str(reason or typ or "Holiday").strip()[:120]
            d = start
            while d <= (end or start):
                if d not in existing_holidays:
                    db.session.add(Holiday(date=d, name=name))
                    existing_holidays.add(d)
                    added_holidays += 1
                d += timedelta(days=1)
            continue
        emp = codes.get(code)
        if not emp:
            errors.append({"row": i, "error": f"Unknown Employee ID {code}."})
            continue
        if end < start or (end - start).days > MAX_SPAN_DAYS:
            errors.append({"row": i, "error": "Invalid date range."})
            continue
        leave_type = next((t for t in LEAVE_TYPES if t.lower() == typ.lower()), "Other")
        half_day = str(half or "").strip().lower() in ("y", "yes", "1", "true") and start == end
        if _overlaps(emp.id, start, end):
            errors.append({"row": i, "error": f"{emp.full_name} already has leave overlapping these dates."})
            continue
        db.session.add(Leave(employee_id=emp.id, leave_type=leave_type, start_date=start, end_date=end,
                             half_day=half_day, days=count_days(start, end, half_day),
                             reason=str(reason or "").strip()[:1000] or None, status="approved", source="import",
                             decided_by=current_user.name, decided_at=now()))
        db.session.flush()
        added_leaves += 1
    audit("imported leaves", "leave", f"{added_leaves} leaves, {added_holidays} holidays from {upload.filename}")
    db.session.commit()
    return ok(added_leaves=added_leaves, added_holidays=added_holidays, errors=errors[:100])
