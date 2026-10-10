"""Daily updates: everyone on the team (interns etc.) reports today's calls — made, left, rejected, no response,
and how many asked for a demo or a video (to follow up later).

Founder logins, the project manager (the "projects" area) and admins given the "daily_updates" area read every
report and see who hasn't sent one. They don't submit one themselves.
"""
from datetime import date, timedelta

from flask import request
from flask_login import current_user, login_required

from ..extensions import db
from ..models import DAILY_COUNTS, DailyUpdate, Employee, User, now
from ..security import employee_required
from ..utils import audit, clean, parse_date
from . import common as S
from .common import bp, body, fail, ok


def reviewer(user):
    return user.is_founder or user.can("projects") or user.can("daily_updates")


def _ser(u):
    d = {k: getattr(u, k) for k in DAILY_COUNTS}
    d.update(id=u.id, day=S.iso(u.day), followup_details=u.followup_details, notes=u.notes,
             employee=S.employee_brief(u.employee) if u.employee else None,
             created_at=S.iso(u.created_at), updated_at=S.iso(u.updated_at))
    return d


def _reporters():
    """Active people with a login who are expected to send a daily update."""
    users = User.query.filter(User.employee_id.isnot(None), User.active.is_(True)).all()
    people = [u.employee for u in users if u.is_active and not reviewer(u)]
    return sorted(people, key=lambda e: e.full_name.lower())


@bp.get("/daily-updates")
@login_required
def daily_updates_list():
    today = date.today()
    out = {"today": today.isoformat(), "can_review": reviewer(current_user), "fields": DAILY_COUNTS}
    if reviewer(current_user):
        day = parse_date(request.args.get("day")) or today
        rows = DailyUpdate.query.filter_by(day=day).all()
        sent = {u.employee_id for u in rows}
        out.update(day=day.isoformat(), updates=[_ser(u) for u in sorted(rows, key=lambda u: u.employee.full_name.lower())],
                   totals={k: sum(getattr(u, k) for u in rows) for k in DAILY_COUNTS},
                   missing=[S.employee_brief(e) for e in _reporters() if e.id not in sent])
    emp = current_user.employee
    out["can_submit"] = emp is not None and not reviewer(current_user)
    if out["can_submit"]:
        mine = (DailyUpdate.query.filter(DailyUpdate.employee_id == emp.id, DailyUpdate.day >= today - timedelta(days=60))
                .order_by(DailyUpdate.day.desc()).all())
        out["mine"] = [_ser(u) for u in mine]
    return ok(**out)


@bp.post("/daily-updates")
@employee_required
def daily_updates_save():
    """Create or replace the current user's update for a day (today by default, or a missed earlier day)."""
    if reviewer(current_user):
        fail("Founders and reviewers don't send daily updates.", 403)
    d = body()
    today = date.today()
    day = parse_date(d.get("day")) or today
    if day > today:
        fail("You can't send an update for a future day.")
    if day < today - timedelta(days=7):
        fail("Updates older than a week can't be changed.")
    counts = {}
    for k in DAILY_COUNTS:
        try:
            v = int(d.get(k) or 0)
        except (TypeError, ValueError):
            fail("Numbers only, please.")
        if v < 0 or v > 100000:
            fail("Numbers must be between 0 and 100000.")
        counts[k] = v
    outcomes = counts["rejected"] + counts["no_response"]
    if outcomes > counts["calls_total"]:
        fail("Rejected + no response can't be more than the total calls made.")
    if counts["demo_requested"] + counts["video_requested"] + outcomes > counts["calls_total"]:
        fail("Rejected, no response, demo and video together can't be more than the total calls made.")
    emp = current_user.employee
    u = DailyUpdate.query.filter_by(employee_id=emp.id, day=day).first()
    created = u is None
    if created:
        u = DailyUpdate(employee_id=emp.id, day=day)
        db.session.add(u)
    for k, v in counts.items():
        setattr(u, k, v)
    u.followup_details = clean(d, "followup_details", 10000) or None
    u.notes = clean(d, "notes", 10000) or None
    u.updated_at = now()
    audit(("sent" if created else "updated") + " daily update", "daily_update", f"{day.isoformat()} · {u.calls_total} calls")
    db.session.commit()
    return ok(update=_ser(u)), 201 if created else 200
