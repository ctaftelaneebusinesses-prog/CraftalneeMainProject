"""Tasks, the organisation tree and sidebar badge counts.

Task rules:
  * Founder / admins can assign to any active employee and see every task.
  * Any employee can assign to people in their reporting line (direct or indirect reports).
  * The assignee can move a task between To do / In progress / Done; the creator (or an admin)
    can edit or delete it. Completion shows up for the creator and on admin dashboards.
  * Inside a task the assignee keeps a checklist and progress notes. Everyone who can see the
    task (founder, Team admins, the assigner, leads above the assignee) can read them.
"""
from collections import Counter
from datetime import date

from flask import request
from flask_login import current_user, login_required
from sqlalchemy import or_

from ..extensions import db
from ..models import TASK_PRIORITIES, TASK_STATUSES, Employee, Leave, Task, TaskItem, TaskNote, now
from ..utils import audit, clean, get_settings, parse_date
from . import common as S
from .common import bp, body, fail, get_or_404, ok
from .announcements import unread_count
from .complaints import open_count as complaints_open_count
from .followups import due_count as followups_due_count
from .employees import descendants


def assignable_ids(user):
    if user.can("team"):
        return {eid for (eid,) in db.session.query(Employee.id).filter_by(status="active")}
    if not user.employee:
        return set()
    active = {eid for (eid,) in db.session.query(Employee.id).filter_by(status="active")}
    return descendants(user.employee_id) & active


def _is_creator(t):
    return t.created_by_id == current_user.id


@bp.get("/tasks")
@login_required
def tasks_list():
    scope = request.args.get("scope", "mine")
    q = Task.query.join(Employee)
    if scope == "mine":
        if not current_user.employee:
            return ok(tasks=[], counts={})
        q = q.filter(Task.assignee_id == current_user.employee_id)
    elif scope == "assigned":
        q = q.filter(Task.created_by_id == current_user.id)
    elif scope == "team":
        ids = descendants(current_user.employee_id) if current_user.employee_id else set()
        q = q.filter(Task.assignee_id.in_(ids or {-1}))
    elif scope == "all":
        if not current_user.can("team"):
            fail("Not allowed.", 403)
    else:
        fail("Unknown scope.")
    assignee = request.args.get("assignee_id", type=int)
    if assignee:
        q = q.filter(Task.assignee_id == assignee)
    text = clean(request.args, "q")
    if text:
        q = q.filter(or_(Task.title.ilike(f"%{text}%"), Task.description.ilike(f"%{text}%"),
                         Employee.full_name.ilike(f"%{text}%")))
    rows = q.order_by(Task.status, Task.due_date.is_(None), Task.due_date, Task.created_at.desc()).limit(500).all()
    counts = Counter(t.status for t in rows)
    return ok(tasks=[S.task(t) for t in rows], counts={s: counts.get(s, 0) for s in TASK_STATUSES})


@bp.get("/tasks/assignable")
@login_required
def tasks_assignable():
    ids = assignable_ids(current_user)
    rows = Employee.query.filter(Employee.id.in_(ids or {-1})).order_by(Employee.full_name).all()
    return ok(employees=[S.employee_brief(e) for e in rows], priorities=TASK_PRIORITIES)


def _apply(t, d, full=True):
    if full:
        title = clean(d, "title", 200)
        if not title:
            fail("Task title is required.")
        t.title = title
        t.description = clean(d, "description", 5000) or None
        t.due_date = parse_date(d.get("due_date"))
        t.priority = d.get("priority") if d.get("priority") in TASK_PRIORITIES else "Medium"
        if "assignee_id" in d:
            aid = int(d.get("assignee_id") or 0)
            if aid not in assignable_ids(current_user):
                fail("You can only assign tasks to people in your reporting line.", 403)
            t.assignee_id = aid
    if "status" in d:
        status = d.get("status")
        if status not in TASK_STATUSES:
            fail("Invalid status.")
        if status != t.status:
            t.status = status
            t.completed_at = now() if status == "done" else None
            return True
    return False


@bp.post("/tasks")
@login_required
def tasks_create():
    d = body()
    if not d.get("assignee_id"):
        fail("Choose who this task is for.")
    t = Task(created_by_id=current_user.id, created_by_name=current_user.name, status="todo")
    _apply(t, d)
    db.session.add(t)
    db.session.flush()
    audit(f"assigned task “{t.title}” to {t.assignee.full_name}", "task")
    db.session.commit()
    return ok(task=S.task(t)), 201


@bp.put("/tasks/<int:task_id>")
@login_required
def tasks_update(task_id):
    t = get_or_404(Task, task_id, "Task")
    d = body()
    manager = current_user.can("team") or _is_creator(t)
    if not manager and t.assignee_id != current_user.employee_id:
        fail("Not allowed.", 403)
    changed_status = _apply(t, d, full=manager and "title" in d)
    if changed_status:
        verb = {"done": "completed", "in_progress": "started", "todo": "reopened"}[t.status]
        audit(f"{verb} task “{t.title}”", "task", f"assigned to {t.assignee.full_name}")
    db.session.commit()
    return ok(task=S.task(t))


@bp.delete("/tasks/<int:task_id>")
@login_required
def tasks_delete(task_id):
    t = get_or_404(Task, task_id, "Task")
    if not (current_user.can("team") or _is_creator(t)):
        fail("Only the person who assigned this task (or an admin) can delete it.", 403)
    audit(f"deleted task “{t.title}”", "task")
    db.session.delete(t)
    db.session.commit()
    return ok(deleted=True)


# ------------------------------------------------------------------ task detail: checklist + notes

def _can_view(t):
    if current_user.can("team") or _is_creator(t) or t.assignee_id == current_user.employee_id:
        return True
    return bool(current_user.employee_id) and t.assignee_id in descendants(current_user.employee_id)


def _can_work(t):
    """Edit the checklist: the assignee, whoever assigned it, or a Team admin."""
    return current_user.can("team") or _is_creator(t) or t.assignee_id == current_user.employee_id


def _viewable(task_id):
    t = get_or_404(Task, task_id, "Task")
    if not _can_view(t):
        fail("Task not found.", 404)
    return t


def _detail(t):
    return S.task(t) | {"items": [S.task_item(i) for i in t.items], "notes": [S.task_note(n) for n in t.notes],
                        "can_work": _can_work(t), "can_manage": current_user.can("team") or _is_creator(t)}


@bp.get("/tasks/<int:task_id>")
@login_required
def tasks_get(task_id):
    return ok(task=_detail(_viewable(task_id)))


@bp.post("/tasks/<int:task_id>/items")
@login_required
def task_items_add(task_id):
    t = _viewable(task_id)
    if not _can_work(t):
        fail("Only the assignee or the person who assigned this task can change its checklist.", 403)
    title = clean(body(), "title", 300)
    if not title:
        fail("Write what needs doing.")
    if len(t.items) >= 100:
        fail("A task can have at most 100 checklist items.")
    t.items.append(TaskItem(title=title, created_by_name=current_user.name,
                            position=max((i.position for i in t.items), default=0) + 1))
    t.updated_at = now()
    db.session.commit()
    return ok(task=_detail(t)), 201


def _item(item_id):
    item = get_or_404(TaskItem, item_id, "Checklist item")
    t = _viewable(item.task_id)
    if not _can_work(t):
        fail("Only the assignee or the person who assigned this task can change its checklist.", 403)
    return item, t


@bp.put("/tasks/items/<int:item_id>")
@login_required
def task_items_update(item_id):
    item, t = _item(item_id)
    d = body()
    if "title" in d:
        title = clean(d, "title", 300)
        if not title:
            fail("Write what needs doing.")
        item.title = title
    if "done" in d:
        done = str(d.get("done")).lower() in ("1", "true")
        if done != item.done:
            item.done, item.done_at = done, now() if done else None
    t.updated_at = now()
    db.session.commit()
    return ok(task=_detail(t))


@bp.delete("/tasks/items/<int:item_id>")
@login_required
def task_items_delete(item_id):
    item, t = _item(item_id)
    db.session.delete(item)
    db.session.commit()
    db.session.refresh(t)
    return ok(task=_detail(t))


@bp.post("/tasks/<int:task_id>/notes")
@login_required
def task_notes_add(task_id):
    t = _viewable(task_id)
    text = clean(body(), "body", 5000)
    if not text:
        fail("Write a note first.")
    t.notes.append(TaskNote(author_id=current_user.id, author_name=current_user.name, body=text))
    audit(f"added a note on task “{t.title}”", "task", text[:120])
    db.session.commit()
    return ok(task=_detail(t)), 201


@bp.delete("/tasks/notes/<int:note_id>")
@login_required
def task_notes_delete(note_id):
    note = get_or_404(TaskNote, note_id, "Note")
    t = _viewable(note.task_id)
    if note.author_id != current_user.id and not current_user.can("team"):
        fail("You can only delete your own notes.", 403)
    db.session.delete(note)
    db.session.commit()
    db.session.refresh(t)
    return ok(task=_detail(t))


# ------------------------------------------------------------------ org tree (read-only for everyone)

@bp.get("/org")
@login_required
def org_tree():
    s = get_settings()
    from ..models import ROLE_FOUNDER, User
    founder = User.query.filter_by(role=ROLE_FOUNDER).first()
    rows = Employee.query.filter_by(status="active").order_by(Employee.full_name).all()
    open_tasks = Counter(t.assignee_id for t in Task.query.filter(Task.status != "done"))
    today = date.today()
    on_leave = {l.employee_id for l in Leave.query.filter(Leave.status == "approved", Leave.start_date <= today,
                                                          Leave.end_date >= today)}
    nodes = []
    for e in rows:
        nodes.append(S.employee_brief(e) | {"manager_id": e.manager_id if e.manager and e.manager.status == "active" else None,
                                            "open_tasks": open_tasks.get(e.id, 0), "on_leave": e.id in on_leave})
    return ok(founder={"name": s.founder_name or (founder.name if founder else "Founder"),
                       "title": s.founder_designation or "Founder", "company": s.company_name,
                       "logo_url": S.company(s)["logo_url"]},
              nodes=nodes, can_edit=current_user.can("team"))


@bp.put("/org/<int:emp_id>")
@login_required
def org_move(emp_id):
    """Admins re-parent an employee in the tree (drag & drop). manager_id null = reports to the founder."""
    if not current_user.can("team"):
        fail("Only admins can change the team structure.", 403)
    emp = get_or_404(Employee, emp_id, "Employee")
    mid = body().get("manager_id")
    mid = int(mid) if mid not in (None, "", 0, "0") else None
    if mid and (mid == emp.id or mid in descendants(emp.id)):
        fail("That would create a loop in the reporting line.")
    manager = get_or_404(Employee, mid, "Manager") if mid else None
    emp.manager_id = manager.id if manager else None
    emp.reporting_person = manager.full_name if manager else get_settings().founder_name
    audit(f"moved {emp.full_name} under {manager.full_name if manager else 'the founder'}", "employee")
    db.session.commit()
    return ok(moved=True)


# ------------------------------------------------------------------ badge counts

@bp.get("/nav-counts")
@login_required
def nav_counts():
    data = {"my_open_tasks": 0, "pending_leaves": 0, "assigned_open": 0, "my_pending_leaves": 0}
    if current_user.employee_id:
        data["my_open_tasks"] = Task.query.filter(Task.assignee_id == current_user.employee_id, Task.status != "done").count()
        data["my_pending_leaves"] = Leave.query.filter_by(employee_id=current_user.employee_id, status="pending").count()
    data["assigned_open"] = Task.query.filter(Task.created_by_id == current_user.id, Task.status != "done").count()
    if current_user.can("leaves"):
        data["pending_leaves"] = Leave.query.filter_by(status="pending").count()
    data["can_assign"] = bool(assignable_ids(current_user))
    data["unread_announcements"] = unread_count(current_user)
    data["followups_due"] = followups_due_count() if current_user.can("followups") else 0
    data["open_complaints"] = complaints_open_count(current_user)
    return ok(**data)
