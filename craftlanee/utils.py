"""Shared helpers: money formatting, parsing, document numbers, uploads, audit, periods."""
import calendar
import io
import mimetypes
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from flask_login import current_user
from werkzeug.utils import secure_filename

from . import storage
from .extensions import db
from .models import AuditLog, CompanySettings

IMAGE_EXTS = {"png", "jpg", "jpeg", "webp"}
DOC_EXTS = IMAGE_EXTS | {"pdf", "doc", "docx", "xls", "xlsx", "txt"}


# ---------------------------------------------------------------- money

def to_decimal(value, default=Decimal("0")):
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value
    text = str(value).replace(",", "").replace("₹", "").strip()
    if not text:
        return default
    try:
        return Decimal(text).quantize(Decimal("0.01"))
    except InvalidOperation:
        return default


def inr(value, symbol="₹", decimals=None):
    """Indian digit grouping: 280000 -> ₹2,80,000. Decimals shown only when non-zero."""
    amount = to_decimal(value)
    negative = amount < 0
    amount = abs(amount)
    whole = int(amount)
    fraction = amount - whole
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups + [tail])
    show_dec = decimals if decimals is not None else fraction != 0
    if show_dec:
        digits += "." + f"{fraction:.2f}"[2:]
    return f"{'-' if negative else ''}{symbol}{digits}"


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
         "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
         "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n):
    return _ONES[n] if n < 20 else (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else ""))


def _three(n):
    h, rest = divmod(n, 100)
    parts = []
    if h:
        parts.append(_ONES[h] + " Hundred")
    if rest:
        parts.append(_two(rest))
    return " ".join(parts)


def amount_in_words(value):
    amount = to_decimal(value)
    rupees = int(abs(amount))
    paise = int(round((abs(amount) - rupees) * 100))
    if rupees == 0 and paise == 0:
        return "Rupees Zero Only"
    parts = []
    crore, rupees = divmod(rupees, 10_000_000)
    lakh, rupees = divmod(rupees, 100_000)
    thousand, rupees = divmod(rupees, 1000)
    if crore:
        parts.append(_three(crore) + " Crore")
    if lakh:
        parts.append(_two(lakh) + " Lakh")
    if thousand:
        parts.append(_two(thousand) + " Thousand")
    if rupees:
        parts.append(_three(rupees))
    words = "Rupees " + " ".join(parts) if parts else "Rupees Zero"
    if paise:
        words += " and " + _two(paise) + " Paise"
    return words + " Only"


# ---------------------------------------------------------------- dates

def parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def fmt_date(value, fmt="%d %b %Y"):
    if not value:
        return "—"
    return value.strftime(fmt)


def month_label(month):
    """'2026-09' -> 'September 2026'."""
    try:
        y, m = (int(x) for x in month.split("-"))
        return f"{calendar.month_name[m]} {y}"
    except (ValueError, AttributeError, IndexError):
        return month or ""


def month_bounds(month):
    y, m = (int(x) for x in month.split("-"))
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def period_range(period, start=None, end=None):
    """Return (label, start_date, end_date) for the finance period selector."""
    today = date.today()
    first = today.replace(day=1)
    if period == "last_month":
        last_end = first - timedelta(days=1)
        s = last_end.replace(day=1)
        return s.strftime("%B %Y"), s, last_end
    if period == "this_year":
        return f"Year {today.year}", date(today.year, 1, 1), date(today.year, 12, 31)
    if period == "all":
        return "All time", None, None
    if period == "custom":
        s, e = parse_date(start), parse_date(end)
        if s and e and s > e:
            s, e = e, s
        label = f"{fmt_date(s) if s else 'Beginning'} – {fmt_date(e) if e else 'Today'}"
        return label, s, e
    return first.strftime("%B %Y"), first, first.replace(
        day=calendar.monthrange(today.year, today.month)[1])


# ---------------------------------------------------------------- document numbers

def next_doc_number(model, kind, year=None):
    """CL-<KIND>-<YEAR>-0001, sequential per kind and year."""
    year = year or date.today().year
    prefix = f"CL-{kind}-{year}-"
    last = (db.session.query(model.number)
            .filter(model.number.like(prefix + "%"))
            .order_by(model.number.desc()).first())
    seq = int(last[0].rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def next_emp_code(employment_type="Full-time"):
    """Next ID in this employment type's own series, e.g. CL-EMP-0003, CL-INT-0001, CL-FREE-0002."""
    from .models import EMP_CODE_PREFIX, Employee
    prefix = EMP_CODE_PREFIX.get(employment_type, EMP_CODE_PREFIX["Full-time"])
    seq = 0
    for (code,) in db.session.query(Employee.emp_code).filter(Employee.emp_code.like(f"{prefix}-%")):
        tail = code[len(prefix) + 1:]
        if tail.isdigit():
            seq = max(seq, int(tail))
    return f"{prefix}-{seq + 1:04d}"


def next_emp_codes():
    from .models import EMPLOYMENT_TYPES
    return {t: next_emp_code(t) for t in EMPLOYMENT_TYPES}


# ---------------------------------------------------------------- storage
# Files live in the configured backend (local disk or Supabase Storage — see storage.py).
# The database stores only the relative key, e.g. "payslips/<uuid>.pdf".

def new_rel_path(folder, ext):
    return f"{folder}/{uuid.uuid4().hex}.{ext}"


def store_bytes(rel_path, data, content_type=None):
    storage.backend().put(rel_path, data, content_type or mimetypes.guess_type(rel_path)[0])


def read_file(rel_path):
    """File contents, or None if it's missing."""
    return storage.backend().get(rel_path) if rel_path else None


def store_pdf(rel_path, build):
    """Run a PDF builder (``build(target)``) into memory and save the result under rel_path."""
    buf = io.BytesIO()
    build(buf)
    store_bytes(rel_path, buf.getvalue(), "application/pdf")


def save_upload(file_storage, folder, allowed=DOC_EXTS):
    """Save an uploaded file under <folder>/. Returns (rel_path, original_name) or (None, None).

    Raises ValueError for disallowed file types.
    """
    if not file_storage or not file_storage.filename:
        return None, None
    original = secure_filename(file_storage.filename) or "file"
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    if ext not in allowed:
        raise ValueError(f"File type '.{ext or '?'}' is not allowed. Allowed: {', '.join(sorted(allowed))}.")
    rel = new_rel_path(folder, ext)
    store_bytes(rel, file_storage.read(), file_storage.mimetype)
    return rel, file_storage.filename[:255]


def delete_file(rel_path):
    if not rel_path:
        return
    try:
        storage.backend().delete(rel_path)
    except Exception:  # noqa: BLE001 - a missing file must never break a request
        pass


# ---------------------------------------------------------------- settings & audit

def get_settings():
    settings = CompanySettings.query.first()
    if settings is None:
        settings = CompanySettings(company_name="CraftLanee")
        db.session.add(settings)
        db.session.commit()
    return settings


def audit(action, category=None, details=None):
    """Record an important action. Caller commits."""
    user = current_user if current_user and current_user.is_authenticated else None
    db.session.add(AuditLog(
        user_id=user.id if user else None,
        user_name=((f"{user.name} (Founder)" if user.is_founder else user.name) if user else "System")[:120],
        action=action if len(action) <= 200 else action[:199] + "…",  # Postgres enforces column lengths
        category=category,
        details=(details or "")[:255] or None,
    ))


def clean(form, key, maxlen=None):
    raw = form.get(key)
    value = "" if raw is None else str(raw).strip()
    return value[:maxlen] if maxlen else value


def safe_next(url):
    """Only allow local redirects."""
    if url and url.startswith("/") and not url.startswith("//") and "\\" not in url:
        return url
    return None
