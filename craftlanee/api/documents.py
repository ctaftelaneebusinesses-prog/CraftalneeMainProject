"""Offer letters, joining letters, MOUs and the Document Center."""
import io
import re
from collections import Counter
from datetime import date, datetime, timedelta

from flask import request, send_file
from sqlalchemy import or_

from .. import pdf
from ..defaults import (DEFAULT_INTERNSHIP_INTRO, DEFAULT_INTERNSHIP_TERMS, DEFAULT_JOINING_BODY, DEFAULT_RELIEVING_BODY,
                        DEFAULT_MOU_TERMS, DEFAULT_NOTICE, DEFAULT_OFFER_INTRO, DEFAULT_OFFER_TERMS, DEFAULT_PROBATION,
                        DEFAULT_WORK_DAYS, DEFAULT_WORK_HOURS, fill_template)
from ..extensions import db
from ..models import (STIPEND_TYPES, Employee, EmployeeDocument, JoiningLetter, Mou, OfferLetter, Payslip,
                      RelievingLetter)
from ..richtext import sanitize_html
from ..security import can_view_document, permission_required
from ..utils import (audit, cap_words, clean, delete_file, get_settings, month_label, new_rel_path, next_doc_number,
                     parse_date, store_pdf, to_decimal)
from . import common as S
from .common import bp, body, fail, fail_if, get_or_404, iso, ok

KINDS = {
    "offer": {"model": OfferLetter, "prefix": "OFFER", "folder": "offer_letters",
              "builder": pdf.offer_letter, "ser": S.offer_letter, "label": "offer letter"},
    "joining": {"model": JoiningLetter, "prefix": "JOIN", "folder": "joining_letters",
                "builder": pdf.joining_letter, "ser": S.joining_letter, "label": "joining letter"},
    "relieving": {"model": RelievingLetter, "prefix": "REL", "folder": "relieving_letters",
                  "builder": pdf.relieving_letter, "ser": S.relieving_letter, "label": "relieving letter"},
}


def _prefix(kind, letter_type=None):
    """Internship offers get their own series (CL-INTERN-…) so they never share numbers with job offers."""
    return "INTERN" if kind == "offer" and letter_type == "internship" else KINDS[kind]["prefix"]


def _existing(model, prefix, emp_id):
    """This person's latest letter in this series, if any (one letter per person per series)."""
    return (model.query.filter(model.employee_id == emp_id, model.number.like(f"CL-{prefix}-%"))
            .order_by(model.id.desc()).first())


_HOME_SERIES = {"INTERN": "INT"}  # whose IDs a letter series is "for"; every other series is EMP
_EMP_CODE = re.compile(r"^CL-([A-Z]+)-(\d+)$")
_YEAR = re.compile(r"-(\d{4})-\d+(?:-R\d+)?$")


def _person_number(prefix, emp, year):
    """The letter number carrying the person's own ID digits, so the two always match:
    intern CL-INT-0002 -> CL-INTERN-2026-0002, CL-EMP-0001 -> CL-OFFER-2026-0001, and IDs from another series
    keep their tag so nobody can clash: CL-PT-0001 -> CL-OFFER-PT-2026-0001. None if the ID isn't CL-XXX-0000."""
    m = _EMP_CODE.match((emp.emp_code or "").strip().upper()) if emp else None
    if not m:
        return None
    tag, digits = m.group(1), int(m.group(2))
    mid = "" if tag == _HOME_SERIES.get(prefix, "EMP") else f"{tag}-"
    return f"CL-{prefix}-{mid}{year}-{digits:04d}"


def _year_of(number):
    m = _YEAR.search(number or "")
    return int(m.group(1)) if m else None


def _letter_number(model, prefix, emp, existing=None):
    """Number for this person's letter in this series (a reissue keeps its original year)."""
    year = (_year_of(existing.number) if existing is not None else None) or date.today().year
    number = _person_number(prefix, emp, year)
    if number:
        holder = model.query.filter_by(number=number).first()
        if holder is None or (existing is not None and holder.id == existing.id):
            return number
    if existing is not None:
        return existing.number
    return next_doc_number(model, prefix)


def align_letter_numbers(log=None):
    """One-off, idempotent: renumber stored letters so each matches its owner's ID (see _person_number).

    A person's latest letter in a series takes the number; older copies of it become <number>-R1, -R2…
    Renumbered letters get their PDF regenerated so the printed number matches."""
    changed = []
    for kind, k in KINDS.items():
        model = k["model"]
        rows = model.query.order_by(model.id).all()
        taken = {l.number: l.id for l in rows}
        groups = {}
        for l in rows:
            groups.setdefault((l.employee_id, _prefix(kind, getattr(l, "letter_type", None))), []).append(l)
        plan = {}
        for (emp_id, prefix), letters in groups.items():
            latest = letters[-1]
            base = _person_number(prefix, db.session.get(Employee, emp_id),
                                  _year_of(latest.number) or (latest.letter_date or date.today()).year)
            if not base:
                continue
            plan[latest.id] = base
            for n, older in enumerate(reversed(letters[:-1]), 1):
                plan[older.id] = f"{base}-R{n}"
        planned = set(plan)
        # never take a number held by a letter that isn't being renumbered
        plan = {i: num for i, num in plan.items() if taken.get(num, i) == i or taken[num] in planned}
        todo = [l for l in rows if l.id in plan and l.number != plan[l.id]]
        if not todo:
            continue
        for l in todo:
            l.number = f"TMP-{kind}-{l.id}"
        db.session.flush()
        for l in todo:
            l.number = plan[l.id]
        db.session.flush()
        changed += [(k, l) for l in todo]
    db.session.commit()
    for k, l in changed:
        try:
            _render(l, k["builder"], k["folder"])
        except Exception as exc:  # noqa: BLE001 — a missing logo or storage hiccup mustn't stop the app starting
            if log:
                log.warning("could not regenerate %s: %s", l.number, exc)
    if changed:
        db.session.commit()
    return [l.number for _, l in changed]


def _kind(kind):
    if kind not in KINDS:
        fail("Unknown letter type.", 404)
    return KINDS[kind]


def _render(obj, builder, folder):
    if not obj.file_path:
        obj.file_path = new_rel_path(folder, "pdf")
    store_pdf(obj.file_path, lambda target: builder(obj, get_settings(), target))


def _apply_offer(l, d):
    l.letter_date = parse_date(d.get("letter_date")) or date.today()
    l.candidate_name = clean(d, "candidate_name", 120)
    l.address = clean(d, "address", 1000) or None
    l.designation = cap_words(clean(d, "designation", 120)) or None
    l.department = clean(d, "department", 120) or None
    l.joining_date = parse_date(d.get("joining_date"))
    l.salary = to_decimal(d.get("salary"))
    l.employment_type = clean(d, "employment_type", 30) or None
    l.work_location = clean(d, "work_location", 120) or None
    l.reporting_person = clean(d, "reporting_person", 120) or None
    l.end_date = parse_date(d.get("end_date"))
    l.letter_type = "internship" if (d.get("letter_type") == "internship" or l.employment_type in STIPEND_TYPES) else "employment"
    l.pay_basis = "percentage" if l.letter_type == "internship" and d.get("pay_basis") == "percentage" else "stipend"
    pct = to_decimal(d.get("commission_percent"))
    l.commission_percent = pct if l.pay_basis == "percentage" and pct > 0 else None
    if l.pay_basis == "percentage":
        l.salary = 0
    l.working_hours = clean(d, "working_hours", 80) or None
    l.work_days = clean(d, "work_days", 80) or None
    employment = l.letter_type == "employment"
    l.probation_period = (clean(d, "probation_period", 40) or None) if employment else None
    l.notice_period = (clean(d, "notice_period", 40) or None) if employment else None
    l.intro = sanitize_html(d.get("intro"))
    l.terms = sanitize_html(d.get("terms"))
    errors = [] if l.candidate_name else ["Employee name is required."]
    if pct > 100:
        errors.append("Percentage can't be more than 100.")
    return errors


def _apply_joining(l, d):
    l.letter_date = parse_date(d.get("letter_date")) or date.today()
    l.employee_name = clean(d, "employee_name", 120)
    l.emp_code = clean(d, "emp_code", 30) or None
    l.designation = cap_words(clean(d, "designation", 120)) or None
    l.department = clean(d, "department", 120) or None
    l.joining_date = parse_date(d.get("joining_date"))
    l.salary = to_decimal(d.get("salary"))
    l.reporting_person = clean(d, "reporting_person", 120) or None
    l.employment_type = clean(d, "employment_type", 30) or None
    l.work_location = clean(d, "work_location", 120) or None
    l.working_hours = clean(d, "working_hours", 80) or None
    l.work_days = clean(d, "work_days", 80) or None
    l.probation_period = clean(d, "probation_period", 40) or None
    l.body = sanitize_html(d.get("body"))
    return [] if l.employee_name else ["Employee name is required."]


def _apply_relieving(l, d):
    l.letter_date = parse_date(d.get("letter_date")) or date.today()
    l.employee_name = clean(d, "employee_name", 120)
    l.emp_code = clean(d, "emp_code", 30) or None
    l.designation = cap_words(clean(d, "designation", 200)) or None
    l.department = clean(d, "department", 120) or None
    l.employment_type = clean(d, "employment_type", 30) or None
    l.joining_date = parse_date(d.get("joining_date"))
    l.resignation_date = parse_date(d.get("resignation_date"))
    l.last_working_day = parse_date(d.get("last_working_day"))
    l.body = sanitize_html(d.get("body"))
    errors = [] if l.employee_name else ["Employee name is required."]
    if not l.last_working_day:
        errors.append("Last working day is required.")
    elif l.joining_date and l.last_working_day < l.joining_date:
        errors.append("Last working day cannot be before the joining date.")
    return errors


APPLY = {"offer": _apply_offer, "joining": _apply_joining, "relieving": _apply_relieving}


def _draft(kind, emp):
    s = get_settings()
    reporting = emp.manager.full_name if emp.manager else (emp.reporting_person or s.founder_name)
    base = {"employee_id": emp.id, "letter_date": iso(date.today()),
            "designation": emp.roles_label or emp.designation, "department": emp.department,
            "joining_date": iso(emp.joining_date), "salary": S.money(emp.monthly_salary),
            "employment_type": emp.employment_type, "work_location": emp.work_location,
            "reporting_person": reporting, "working_hours": s.work_hours or DEFAULT_WORK_HOURS,
            "work_days": s.work_days or DEFAULT_WORK_DAYS}
    stipend = emp.employment_type in STIPEND_TYPES
    probation = None if stipend else (s.probation_period or DEFAULT_PROBATION)
    if kind == "offer":
        intern = emp.employment_type in STIPEND_TYPES
        return base | {"candidate_name": emp.full_name, "address": emp.address, "end_date": iso(emp.end_date),
                       "letter_type": "internship" if intern else "employment",
                       "pay_basis": "stipend", "commission_percent": None, "probation_period": probation,
                       "notice_period": None if intern else (s.notice_period or DEFAULT_NOTICE),
                       "intro": fill_template(DEFAULT_INTERNSHIP_INTRO if intern else DEFAULT_OFFER_INTRO, emp, s),
                       "terms": (s.internship_terms or DEFAULT_INTERNSHIP_TERMS) if intern
                       else (s.offer_terms or DEFAULT_OFFER_TERMS)}
    if kind == "relieving":
        lwd = emp.end_date if emp.end_date and emp.end_date <= date.today() + timedelta(days=90) else date.today()
        return base | {"employee_name": emp.full_name, "emp_code": emp.emp_code, "resignation_date": None,
                       "last_working_day": iso(lwd), "mark_inactive": emp.status == "active",
                       "body": fill_template(s.relieving_body or DEFAULT_RELIEVING_BODY, emp, s,
                                             last_working_day=lwd.strftime("%d %B %Y"))}
    return base | {"employee_name": emp.full_name, "emp_code": emp.emp_code, "probation_period": probation,
                   "body": fill_template(s.joining_body or DEFAULT_JOINING_BODY, emp, s)}


def _pdf_response(builder, obj, name):
    buf = io.BytesIO()
    builder(obj, get_settings(), buf)
    buf.seek(0)
    resp = send_file(buf, mimetype="application/pdf", download_name=name)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.post("/letters/<kind>/preview")
@permission_required("documents")
def letters_preview(kind):
    """Render the real PDF from unsaved form values — nothing is stored."""
    k = _kind(kind)
    d = body()
    letter = k["model"](employee_id=int(d.get("employee_id") or 0) or None)
    APPLY[kind](letter, d)
    if not clean(d, "number", 40):
        emp = db.session.get(Employee, letter.employee_id or 0)
        prefix = _prefix(kind, getattr(letter, "letter_type", None))
        letter.number = (_letter_number(k["model"], prefix, emp, _existing(k["model"], prefix, emp.id)) if emp
                         else next_doc_number(k["model"], prefix))
    else:
        letter.number = clean(d, "number", 40)
    return _pdf_response(k["builder"], letter, f"{letter.number}-preview.pdf")


@bp.get("/letters/<kind>")
@permission_required("documents")
def letters_list(kind):
    k = _kind(kind)
    model = k["model"]
    q = clean(request.args, "q")
    archived = request.args.get("show") == "archived"
    query = model.query.join(Employee).filter(model.archived.is_(archived))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(model.number.ilike(like), Employee.full_name.ilike(like),
                                 Employee.emp_code.ilike(like), model.designation.ilike(like)))
    return ok(letters=[k["ser"](l) for l in query.order_by(model.created_at.desc())])


@bp.get("/letters/<kind>/draft")
@permission_required("documents")
def letters_draft(kind):
    k = _kind(kind)
    emp = get_or_404(Employee, request.args.get("employee_id", type=int) or 0, "Employee")
    draft = _draft(kind, emp)

    def number(letter_type=None):
        prefix = _prefix(kind, letter_type)
        return _letter_number(k["model"], prefix, emp, _existing(k["model"], prefix, emp.id))

    previews = {t: number(t) for t in ("employment", "internship")} if kind == "offer" else {}
    return ok(draft=draft, number_preview=number(draft.get("letter_type")), number_previews=previews,
              employee=S.employee_brief(emp))


@bp.post("/letters/<kind>")
@permission_required("documents")
def letters_create(kind):
    k = _kind(kind)
    d = body()
    emp = get_or_404(Employee, int(d.get("employee_id") or 0), "Employee")
    letter = k["model"](employee_id=emp.id)  # not added to the session until we know it's a new letter
    fail_if(APPLY[kind](letter, d))
    prefix = _prefix(kind, getattr(letter, "letter_type", None))
    existing = _existing(k["model"], prefix, emp.id)
    if existing is not None:
        # Same person, same kind of letter: reissue it under their number instead of starting a new one.
        letter = existing
        APPLY[kind](letter, d)
        letter.archived = False
    letter.number = _letter_number(k["model"], prefix, emp, existing)
    if existing is None:
        db.session.add(letter)
    db.session.flush()
    _render(letter, k["builder"], k["folder"])
    audit(f"{'reissued' if existing is not None else 'generated'} {k['label']} {letter.number} for {emp.full_name}",
          "document")
    if kind == "relieving" and str(d.get("mark_inactive", "")).lower() in ("1", "true") and emp.status == "active":
        emp.status = "inactive"          # relieved: off future payrolls, portal login stops working
        emp.end_date = emp.end_date or letter.last_working_day
        audit(f"deactivated employee {emp.full_name} (relieved)", "employee")
    db.session.commit()
    return ok(letter=k["ser"](letter)), 201


@bp.get("/letters/<kind>/<int:letter_id>")
@permission_required("documents")
def letters_get(kind, letter_id):
    k = _kind(kind)
    l = get_or_404(k["model"], letter_id, "Letter")
    return ok(letter=k["ser"](l), employee=S.employee_brief(l.employee))


@bp.put("/letters/<kind>/<int:letter_id>")
@permission_required("documents")
def letters_update(kind, letter_id):
    k = _kind(kind)
    letter = get_or_404(k["model"], letter_id, "Letter")
    errors = APPLY[kind](letter, body())
    if errors:
        db.session.rollback()
        fail_if(errors)
    _render(letter, k["builder"], k["folder"])
    audit(f"updated {k['label']} {letter.number}", "document")
    db.session.commit()
    return ok(letter=k["ser"](letter))


@bp.post("/letters/<kind>/<int:letter_id>/archive")
@permission_required("documents")
def letters_archive(kind, letter_id):
    k = _kind(kind)
    letter = get_or_404(k["model"], letter_id, "Letter")
    letter.archived = not letter.archived
    audit(f"{'archived' if letter.archived else 'restored'} {k['label']} {letter.number}", "document")
    db.session.commit()
    return ok(letter=k["ser"](letter))


@bp.delete("/letters/<kind>/<int:letter_id>")
@permission_required("documents")
def letters_delete(kind, letter_id):
    """Delete a letter and its PDF for good (archive keeps a record instead)."""
    k = _kind(kind)
    letter = get_or_404(k["model"], letter_id, "Letter")
    path, number = letter.file_path, letter.number
    who = letter.employee.full_name if letter.employee else getattr(letter, "candidate_name", None)
    db.session.delete(letter)
    audit(f"deleted {k['label']} {number}", "document", who)
    db.session.commit()
    delete_file(path)
    return ok(deleted=True)


# ------------------------------------------------------------------ MOUs

MOU_TEXT = {"party_name": 160, "contact_person": 120, "address": 1000,
            "signatory": 120, "signatory_designation": 120}
MOU_RICH = ("purpose", "scope", "payment_terms", "responsibilities", "terms")


def _apply_mou(m, d):
    for field, maxlen in MOU_TEXT.items():
        setattr(m, field, clean(d, field, maxlen) or None)
    for field in MOU_RICH:
        setattr(m, field, sanitize_html(d.get(field)) or None)
    m.start_date = parse_date(d.get("start_date"))
    m.end_date = parse_date(d.get("end_date"))
    errors = []
    if not m.party_name:
        errors.append("Party / organisation name is required.")
    if m.start_date and m.end_date and m.end_date < m.start_date:
        errors.append("End date cannot be before start date.")
    return errors


@bp.get("/mous")
@permission_required("documents")
def mous_list():
    q = clean(request.args, "q")
    archived = request.args.get("show") == "archived"
    query = Mou.query.filter(Mou.archived.is_(archived))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Mou.number.ilike(like), Mou.party_name.ilike(like),
                                 Mou.contact_person.ilike(like), Mou.purpose.ilike(like)))
    return ok(mous=[S.mou(m) for m in query.order_by(Mou.created_at.desc())])


@bp.get("/mous/new")
@permission_required("documents")
def mous_new():
    s = get_settings()
    return ok(number_preview=next_doc_number(Mou, "MOU"),
              defaults={"signatory": s.founder_name, "signatory_designation": s.founder_designation,
                        "terms": s.mou_terms or DEFAULT_MOU_TERMS})


@bp.post("/mous/preview")
@permission_required("documents")
def mous_preview():
    d = body()
    m = Mou()
    _apply_mou(m, d)
    m.party_name = m.party_name or "Second Party"
    m.number = clean(d, "number", 40) or next_doc_number(Mou, "MOU")
    m.created_at = datetime.now()
    return _pdf_response(pdf.mou, m, f"{m.number}-preview.pdf")


@bp.post("/mous")
@permission_required("documents")
def mous_create():
    m = Mou()
    fail_if(_apply_mou(m, body()))
    m.number = next_doc_number(Mou, "MOU")
    db.session.add(m)
    db.session.flush()
    _render(m, pdf.mou, "mous")
    audit(f"created MOU {m.number} with {m.party_name}", "document")
    db.session.commit()
    return ok(mou=S.mou(m)), 201


@bp.get("/mous/<int:mou_id>")
@permission_required("documents")
def mous_get(mou_id):
    return ok(mou=S.mou(get_or_404(Mou, mou_id, "MOU")))


@bp.put("/mous/<int:mou_id>")
@permission_required("documents")
def mous_update(mou_id):
    m = get_or_404(Mou, mou_id, "MOU")
    errors = _apply_mou(m, body())
    if errors:
        db.session.rollback()
        fail_if(errors)
    _render(m, pdf.mou, "mous")
    audit(f"updated MOU {m.number}", "document")
    db.session.commit()
    return ok(mou=S.mou(m))


@bp.post("/mous/<int:mou_id>/archive")
@permission_required("documents")
def mous_archive(mou_id):
    m = get_or_404(Mou, mou_id, "MOU")
    m.archived = not m.archived
    audit(f"{'archived' if m.archived else 'restored'} MOU {m.number}", "document")
    db.session.commit()
    return ok(mou=S.mou(m))


@bp.delete("/mous/<int:mou_id>")
@permission_required("documents")
def mous_delete(mou_id):
    m = get_or_404(Mou, mou_id, "MOU")
    path, number, party = m.file_path, m.number, m.party_name
    db.session.delete(m)
    audit(f"deleted MOU {number}", "document", party)
    db.session.commit()
    delete_file(path)
    return ok(deleted=True)


# ------------------------------------------------------------------ Document Center

CATEGORIES = ("all", "mou", "offer", "joining", "relieving", "payslip", "other")
KIND_CATEGORY = {"mou": "mou", "offer": "offer", "joining": "joining", "relieving": "relieving",
                 "payslip": "payslip", "doc": "other"}


def collect(category="all", q="", archived=False, limit=None):
    items = []
    like = f"%{q}%" if q else None

    def emp_filter(query, *cols):
        if like:
            query = query.filter(or_(Employee.full_name.ilike(like), Employee.emp_code.ilike(like),
                                     *[c.ilike(like) for c in cols]))
        return query

    if category in ("all", "mou"):
        query = Mou.query.filter(Mou.archived.is_(archived))
        if like:
            query = query.filter(or_(Mou.number.ilike(like), Mou.party_name.ilike(like),
                                     Mou.contact_person.ilike(like)))
        for m in query:
            items.append({"type": "MOU", "kind": "mou", "id": m.id, "number": m.number,
                          "title": m.party_name, "subtitle": m.contact_person or "Organisation",
                          "date": iso(m.created_at), "employee_id": None, "archived": m.archived,
                          "file_url": S.file_url("mou", m)})
    if category in ("all", "offer"):
        for l in emp_filter(OfferLetter.query.join(Employee)
                            .filter(OfferLetter.archived.is_(archived)), OfferLetter.number):
            items.append({"type": "Offer Letter", "kind": "offer", "id": l.id, "number": l.number,
                          "title": l.candidate_name, "subtitle": l.designation or "",
                          "date": iso(l.created_at), "employee_id": l.employee_id,
                          "archived": l.archived, "file_url": S.file_url("offer", l)})
    if category in ("all", "joining"):
        for l in emp_filter(JoiningLetter.query.join(Employee)
                            .filter(JoiningLetter.archived.is_(archived)), JoiningLetter.number):
            items.append({"type": "Joining Letter", "kind": "joining", "id": l.id, "number": l.number,
                          "title": l.employee_name, "subtitle": l.designation or "",
                          "date": iso(l.created_at), "employee_id": l.employee_id,
                          "archived": l.archived, "file_url": S.file_url("joining", l)})
    if category in ("all", "relieving"):
        for l in emp_filter(RelievingLetter.query.join(Employee)
                            .filter(RelievingLetter.archived.is_(archived)), RelievingLetter.number):
            items.append({"type": "Relieving Letter", "kind": "relieving", "id": l.id, "number": l.number,
                          "title": l.employee_name, "subtitle": f"Last day {l.last_working_day:%d %b %Y}" if l.last_working_day else "",
                          "date": iso(l.created_at), "employee_id": l.employee_id,
                          "archived": l.archived, "file_url": S.file_url("relieving", l)})
    if category in ("all", "payslip") and not archived:
        for p in emp_filter(Payslip.query.join(Employee), Payslip.number, Payslip.month):
            items.append({"type": "Payslip", "kind": "payslip", "id": p.id, "number": p.number,
                          "title": p.employee.full_name, "subtitle": month_label(p.month),
                          "date": iso(p.created_at), "employee_id": p.employee_id,
                          "archived": False, "file_url": S.file_url("payslip", p)})
    if category in ("all", "other"):
        for d in emp_filter(EmployeeDocument.query.join(Employee)
                            .filter(EmployeeDocument.archived.is_(archived)), EmployeeDocument.title):
            items.append({"type": "Document", "kind": "doc", "id": d.id, "number": d.title,
                          "title": d.employee.full_name, "subtitle": d.original_name or "",
                          "date": iso(d.created_at), "employee_id": d.employee_id,
                          "archived": d.archived, "file_url": S.file_url("doc", d)})
    items.sort(key=lambda i: i["date"] or "", reverse=True)
    return items[:limit] if limit else items


@bp.get("/documents")
@permission_required("documents")
def documents_index():
    category = request.args.get("category", "all")
    if category not in CATEGORIES:
        category = "all"
    archived = request.args.get("show") == "archived"
    q = clean(request.args, "q")
    # One pass over everything visible gives the tab counts; the listed items reuse it when possible.
    everything = [i for i in collect("all", "", archived) if can_view_document(i["kind"])]
    tab = Counter(KIND_CATEGORY.get(i["kind"], "other") for i in everything)
    counts = {c: len(everything) if c == "all" else tab.get(c, 0) for c in CATEGORIES}
    if q:
        items = [i for i in collect(category, q, archived) if can_view_document(i["kind"])]
    else:
        items = [i for i in everything if category == "all" or KIND_CATEGORY.get(i["kind"], "other") == category]
    return ok(items=items, counts=counts)
