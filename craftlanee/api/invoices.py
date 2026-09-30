"""Client invoices: line items, tax, PDF, and paid ⇄ income.

Marking an invoice paid records a Received income row linked to it; that row is locked in
Finance (like payroll expenses) and is removed again if the invoice is marked unpaid.
"""
import io
import json
from datetime import date
from decimal import Decimal, InvalidOperation

from flask import request, send_file
from sqlalchemy import or_

from .. import pdf
from ..extensions import db
from ..models import PAYMENT_METHODS, Income, Invoice
from ..security import permission_required
from ..utils import (audit, clean, delete_file, get_settings, inr, new_rel_path, next_doc_number, parse_date,
                     store_pdf, to_decimal)
from . import common as S
from .common import bp, body, fail, fail_if, get_or_404, ok

TEXT = {"client_name": 160, "client_address": 1000, "client_email": 160, "client_phone": 30,
        "client_gstin": 20, "tax_label": 30, "notes": 3000, "terms": 3000}
MAX_LINES = 60
DEFAULT_TERMS = "Payment is due by the due date. Please mention the invoice number with your payment."


def _num(value):
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, ValueError):
        return None


def _apply(inv, d):
    errors = []
    for field, maxlen in TEXT.items():
        setattr(inv, field, clean(d, field, maxlen) or None)
    inv.tax_label = inv.tax_label or "GST"
    inv.client_gstin = inv.client_gstin.upper() if inv.client_gstin else None
    inv.invoice_date = parse_date(d.get("invoice_date")) or date.today()
    inv.due_date = parse_date(d.get("due_date"))
    raw = d.get("items") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    lines = []
    for n, row in enumerate(raw if isinstance(raw, list) else [], 1):
        if not isinstance(row, dict):
            continue
        desc = str(row.get("description") or "").strip()[:500]
        qty, rate = _num(row.get("qty")), _num(row.get("rate"))
        if not desc and not qty and not rate:
            continue  # blank row
        if qty is None or rate is None:
            errors.append(f"Line {n}: quantity and rate must be numbers.")
            continue
        if not desc:
            errors.append(f"Line {n}: add a description.")
        if qty <= 0 or rate < 0:
            errors.append(f"Line {n}: quantity must be above zero and rate can't be negative.")
        lines.append({"description": desc, "qty": str(qty), "rate": str(rate)})
    if len(lines) > MAX_LINES:
        errors.append(f"An invoice can have at most {MAX_LINES} lines.")
    inv.items = json.dumps(lines)
    rate = _num(d.get("tax_rate"))
    if rate is None or rate < 0 or rate > 100:
        errors.append("Tax rate must be between 0 and 100%.")
    else:
        inv.tax_rate = rate
    inv.discount = to_decimal(d.get("discount"))
    if not inv.client_name:
        errors.append("Client name is required.")
    if not lines:
        errors.append("Add at least one line item.")
    if inv.discount < 0:
        errors.append("Discount can't be negative.")
    elif not errors and inv.discount > inv.subtotal:
        errors.append("Discount can't be more than the subtotal.")
    if inv.due_date and inv.due_date < inv.invoice_date:
        errors.append("Due date can't be before the invoice date.")
    return errors


def _render(inv):
    if not inv.file_path:
        inv.file_path = new_rel_path("invoices", "pdf")
    store_pdf(inv.file_path, lambda target: pdf.invoice(inv, get_settings(), target))


def _summary():
    rows = Invoice.query.filter(Invoice.status != "cancelled").all()
    unpaid = [i for i in rows if i.status == "unpaid"]
    year = date.today().year
    return {"outstanding": S.money(sum((i.total for i in unpaid), Decimal(0))),
            "overdue": S.money(sum((i.total for i in unpaid if i.is_overdue), Decimal(0))),
            "overdue_count": sum(1 for i in unpaid if i.is_overdue), "unpaid_count": len(unpaid),
            "paid_this_year": S.money(sum((i.total for i in rows if i.status == "paid" and i.paid_date
                                           and i.paid_date.year == year), Decimal(0)))}


def _clients():
    """Previous clients, most recent first, to pre-fill the form."""
    seen, out = set(), []
    for i in Invoice.query.order_by(Invoice.id.desc()).limit(200):
        if i.client_name.lower() in seen:
            continue
        seen.add(i.client_name.lower())
        out.append({"client_name": i.client_name, "client_address": i.client_address,
                    "client_email": i.client_email, "client_phone": i.client_phone, "client_gstin": i.client_gstin})
    return out


@bp.get("/invoices")
@permission_required("finance")
def invoices_list():
    status = request.args.get("status", "all")
    q = clean(request.args, "q")
    query = Invoice.query
    if status in ("unpaid", "paid", "cancelled", "overdue"):
        query = query.filter_by(status="unpaid" if status == "overdue" else status)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Invoice.number.ilike(like), Invoice.client_name.ilike(like),
                                 Invoice.client_email.ilike(like), Invoice.items.ilike(like)))
    rows = query.order_by(Invoice.invoice_date.desc(), Invoice.id.desc()).all()
    if status == "overdue":
        rows = [i for i in rows if i.is_overdue]
    return ok(invoices=[S.invoice(i) for i in rows], summary=_summary())


@bp.get("/invoices/new")
@permission_required("finance")
def invoices_new():
    """Next number plus defaults carried over from the most recent invoice."""
    last = Invoice.query.order_by(Invoice.id.desc()).first()
    return ok(number_preview=next_doc_number(Invoice, "INV"),
              defaults={"tax_label": last.tax_label if last else "GST",
                        "tax_rate": float(last.tax_rate) if last else 18,
                        "notes": (last.notes if last else "") or "",
                        "terms": (last.terms if last else DEFAULT_TERMS) or ""},
              clients=_clients(), payment_methods=PAYMENT_METHODS)


@bp.post("/invoices/preview")
@permission_required("finance")
def invoices_preview():
    """Render the real PDF from unsaved form values; nothing is stored."""
    d = body()
    number = None
    if d.get("id"):
        number = get_or_404(Invoice, int(d["id"]), "Invoice").number
    inv = Invoice(status="unpaid")
    _apply(inv, d)
    inv.client_name = inv.client_name or "Client name"
    inv.number = number or next_doc_number(Invoice, "INV")
    buf = io.BytesIO()
    pdf.invoice(inv, get_settings(), buf)
    buf.seek(0)
    resp = send_file(buf, mimetype="application/pdf", download_name=f"{inv.number}-preview.pdf")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.post("/invoices")
@permission_required("finance")
def invoices_create():
    inv = Invoice(status="unpaid")
    fail_if(_apply(inv, body()))
    inv.number = next_doc_number(Invoice, "INV")
    db.session.add(inv)
    db.session.flush()
    _render(inv)
    audit(f"created invoice {inv.number} for {inv.client_name}", "finance", inr(inv.total))
    db.session.commit()
    return ok(invoice=S.invoice(inv)), 201


@bp.get("/invoices/<int:inv_id>")
@permission_required("finance")
def invoices_get(inv_id):
    return ok(invoice=S.invoice(get_or_404(Invoice, inv_id, "Invoice")))


@bp.put("/invoices/<int:inv_id>")
@permission_required("finance")
def invoices_update(inv_id):
    inv = get_or_404(Invoice, inv_id, "Invoice")
    if inv.status == "paid":
        fail("This invoice is paid. Mark it unpaid before editing it.", 409)
    errors = _apply(inv, body())
    if errors:
        db.session.rollback()
        fail_if(errors)
    _render(inv)
    audit(f"updated invoice {inv.number}", "finance", inr(inv.total))
    db.session.commit()
    return ok(invoice=S.invoice(inv))


@bp.post("/invoices/<int:inv_id>/paid")
@permission_required("finance")
def invoices_paid(inv_id):
    inv = get_or_404(Invoice, inv_id, "Invoice")
    if inv.status != "unpaid":
        fail("Only unpaid invoices can be marked paid.", 409)
    d = body()
    inv.status = "paid"
    inv.paid_date = parse_date(d.get("paid_date")) or date.today()
    inv.payment_method = d.get("payment_method") if d.get("payment_method") in PAYMENT_METHODS else None
    income = Income(date=inv.paid_date, source=f"Invoice {inv.number}", client=inv.client_name,
                    description=", ".join(l["description"] for l in inv.lines)[:2000] or None,
                    amount=inv.total, payment_status="Received",
                    notes=f"Paid via {inv.payment_method}" if inv.payment_method else None)
    db.session.add(income)
    inv.income = income
    _render(inv)
    audit(f"marked invoice {inv.number} paid", "finance", f"{inv.client_name} · {inr(inv.total)}")
    db.session.commit()
    return ok(invoice=S.invoice(inv), message=f"{inv.number} marked paid — {inr(inv.total)} added to income.")


@bp.post("/invoices/<int:inv_id>/unpaid")
@permission_required("finance")
def invoices_unpaid(inv_id):
    inv = get_or_404(Invoice, inv_id, "Invoice")
    if inv.status != "paid":
        fail("This invoice isn't paid.", 409)
    if inv.income:
        db.session.delete(inv.income)
    inv.income, inv.status, inv.paid_date, inv.payment_method = None, "unpaid", None, None
    _render(inv)
    audit(f"marked invoice {inv.number} unpaid", "finance", "linked income removed")
    db.session.commit()
    return ok(invoice=S.invoice(inv), message=f"{inv.number} is unpaid again; its income entry was removed.")


@bp.post("/invoices/<int:inv_id>/cancel")
@permission_required("finance")
def invoices_cancel(inv_id):
    """Toggle cancelled. Paid invoices must be marked unpaid first."""
    inv = get_or_404(Invoice, inv_id, "Invoice")
    if inv.status == "paid":
        fail("Mark the invoice unpaid before cancelling it.", 409)
    inv.status = "unpaid" if inv.status == "cancelled" else "cancelled"
    _render(inv)
    audit(f"{'cancelled' if inv.status == 'cancelled' else 'restored'} invoice {inv.number}", "finance")
    db.session.commit()
    return ok(invoice=S.invoice(inv))


@bp.delete("/invoices/<int:inv_id>")
@permission_required("finance")
def invoices_delete(inv_id):
    inv = get_or_404(Invoice, inv_id, "Invoice")
    if inv.status == "paid":
        fail("Paid invoices can't be deleted. Mark it unpaid first.", 409)
    path, number = inv.file_path, inv.number
    db.session.delete(inv)
    audit(f"deleted invoice {number}", "finance")
    db.session.commit()
    delete_file(path)
    return ok(deleted=True)
