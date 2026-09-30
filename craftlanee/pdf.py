"""Branded, print-ready A4 documents (ReportLab).

Design: corporate letterhead (logo, name, contact) under a two-tone brand strip, a clean
reference/date line, numbered section headings with an accent rule, summary tables, a
signature block and a "Page X of Y" footer. Every builder accepts a file path or a file-like
object (used for live previews).
"""
import io
import os
from datetime import date, timedelta
from decimal import Decimal
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

from .models import FIXED_TERM_TYPES, STIPEND_TYPES
from .richtext import rich_flowables
from .utils import amount_in_words, read_file, fmt_date, inr, month_bounds, month_label

INK = colors.HexColor("#161A2E")
BODY = colors.HexColor("#2B3045")
MUTED = colors.HexColor("#5E6478")
FAINT = colors.HexColor("#8C92A5")
LINE = colors.HexColor("#E2E4EC")
SOFT = colors.HexColor("#F5F6FA")
SOFT2 = colors.HexColor("#EEF0F7")
ACCENT = colors.HexColor("#5B3FE0")
ACCENT2 = colors.HexColor("#E8612C")

PAGE_W, PAGE_H = A4
MX = 18 * mm
HEADER_H = 38 * mm
FOOTER_H = 15 * mm
CONTENT_W = PAGE_W - 2 * MX

# ------------------------------------------------------------------ fonts

_HERE = os.path.dirname(__file__)
_WIN = "C:/Windows/Fonts/"
_DV = "/usr/share/fonts/truetype/dejavu/"
_FONT_SETS = {
    "sans": [
        tuple(os.path.join(_HERE, "fonts", f"Body-{v}.ttf") for v in ("Regular", "Bold", "Italic", "BoldItalic")),
        tuple(_WIN + f for f in ("segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf")),
        tuple(_WIN + f for f in ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf")),
        tuple(_DV + f for f in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf")),
    ],
    "serif": [
        tuple(_WIN + f for f in ("georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf")),
        tuple(_WIN + f for f in ("times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf")),
        tuple(_DV + f for f in ("DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif-Italic.ttf", "DejaVuSerif-BoldItalic.ttf")),
    ],
    "mono": [
        tuple(_WIN + f for f in ("consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf")),
        tuple(_DV + f for f in ("DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSansMono-Oblique.ttf", "DejaVuSansMono-BoldOblique.ttf")),
    ],
}
_BUILTIN = {"sans": ("Helvetica", "Helvetica-Bold"), "serif": ("Times-Roman", "Times-Bold"),
            "mono": ("Courier", "Courier-Bold")}
_fonts = None


def fonts():
    """Register Unicode TTF families (so ₹ renders). Returns font names + the rupee symbol to use."""
    global _fonts
    if _fonts:
        return _fonts
    out = {}
    for fam, candidates in _FONT_SETS.items():
        name = f"CL{fam.title()}"
        for files in candidates:
            if all(os.path.exists(f) for f in files):
                try:
                    names = [name, f"{name}-B", f"{name}-I", f"{name}-BI"]
                    for n, f in zip(names, files):
                        pdfmetrics.registerFont(TTFont(n, f))
                    pdfmetrics.registerFontFamily(name, normal=names[0], bold=names[1], italic=names[2], boldItalic=names[3])
                    out[fam], out[f"{fam}_b"] = name, f"{name}-B"
                    break
                except Exception:  # noqa: BLE001 - try the next candidate
                    continue
        if fam not in out:
            out[fam], out[f"{fam}_b"] = _BUILTIN[fam]
    has_rupee = out["sans"].startswith("CL") and 0x20B9 in getattr(pdfmetrics.getFont(out["sans"]).face, "charToGlyph", {})
    out["rupee"] = "₹" if has_rupee else "Rs. "
    _fonts = out
    return out


def money(value):
    return inr(value, symbol=fonts()["rupee"])


def long_date(d):
    return fmt_date(d, "%d %B %Y") if d else "—"


def styles():
    f = fonts()
    base = ParagraphStyle("base", fontName=f["sans"], fontSize=10, leading=15.5, textColor=BODY)
    return {
        "body": ParagraphStyle("body", parent=base, alignment=TA_JUSTIFY, spaceAfter=7),
        "item": ParagraphStyle("item", parent=base, alignment=TA_JUSTIFY, spaceAfter=4, leading=15),
        "plain": base,
        "strong": ParagraphStyle("strong", parent=base, fontName=f["sans_b"], textColor=INK),
        "small": ParagraphStyle("small", parent=base, fontSize=8.5, leading=12.5, textColor=MUTED),
        "tiny": ParagraphStyle("tiny", parent=base, fontSize=7.5, leading=10.5, textColor=FAINT),
        "tag": ParagraphStyle("tag", parent=base, fontName=f["sans_b"], fontSize=7.5, leading=10, textColor=ACCENT2),
        "label": ParagraphStyle("label", parent=base, fontSize=8.5, leading=12, textColor=MUTED),
        "value": ParagraphStyle("value", parent=base, fontName=f["sans_b"], fontSize=9.5, leading=13, textColor=INK),
        "title": ParagraphStyle("title", parent=base, fontName=f["sans_b"], fontSize=19, leading=24, textColor=INK),
        "title_c": ParagraphStyle("title_c", parent=base, fontName=f["sans_b"], fontSize=18, leading=23,
                                  textColor=INK, alignment=TA_CENTER),
        "sub_c": ParagraphStyle("sub_c", parent=base, fontSize=9, leading=13, textColor=MUTED, alignment=TA_CENTER),
        "subject": ParagraphStyle("subject", parent=base, fontName=f["sans_b"], fontSize=11, leading=15, textColor=INK),
        "h2": ParagraphStyle("h2", parent=base, fontName=f["sans_b"], fontSize=10.5, leading=14, textColor=INK),
        "cell": ParagraphStyle("cell", parent=base, fontSize=9.5, leading=13),
        "cellb": ParagraphStyle("cellb", parent=base, fontName=f["sans_b"], fontSize=9.5, leading=13, textColor=INK),
        "cellr": ParagraphStyle("cellr", parent=base, fontSize=9.5, leading=13, alignment=TA_RIGHT),
        "cellrb": ParagraphStyle("cellrb", parent=base, fontName=f["sans_b"], fontSize=9.5, leading=13,
                                 alignment=TA_RIGHT, textColor=INK),
        "bullet_color": ACCENT,
    }


def P(text, style):
    return Paragraph(escape(str(text or "")).replace("\n", "<br/>"), style)


def M(markup, style):
    """Paragraph from trusted markup (callers escape user values)."""
    return Paragraph(markup, style)


def rich(value, st, mode="paragraphs"):
    return rich_flowables(value, st, fonts(), mode)


_IMAGES = {}  # rel_path -> bytes. Keys are unique per upload (a new logo gets a new key), so never stale.


def _image(rel_path, max_w, max_h):
    """(image bytes, width, height) scaled to fit, or None. Company images are cached in memory
    because every page's header draws them and they may live in remote storage."""
    if not rel_path:
        return None
    try:
        data = _IMAGES.get(rel_path)
        if data is None:
            data = read_file(rel_path)
            if data is None:
                return None
            if len(_IMAGES) > 32:
                _IMAGES.clear()
            _IMAGES[rel_path] = data
        iw, ih = ImageReader(io.BytesIO(data)).getSize()
        scale = min(max_w / iw, max_h / ih)
        return data, iw * scale, ih * scale
    except Exception:  # noqa: BLE001 - a bad image must never block a document
        return None


# ------------------------------------------------------------------ page template

class _NumberedCanvas(rl_canvas.Canvas):
    """Two-pass canvas so the footer can say "Page X of Y"."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pages = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self.setFont(fonts()["sans"], 7.5)
            self.setFillColor(FAINT)
            self.drawRightString(PAGE_W - MX, FOOTER_H - 7 * mm,
                                 f"{getattr(self, '_cl_label', '')}   ·   Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


class _Page:
    def __init__(self, settings, label):
        self.s, self.label = settings, label

    def __call__(self, c, doc):
        f = fonts()
        s = self.s
        c.saveState()
        c._cl_label = self.label
        c.setFillColor(ACCENT)
        c.rect(0, PAGE_H - 2.2 * mm, PAGE_W * 0.72, 2.2 * mm, stroke=0, fill=1)
        c.setFillColor(ACCENT2)
        c.rect(PAGE_W * 0.72, PAGE_H - 2.2 * mm, PAGE_W * 0.28, 2.2 * mm, stroke=0, fill=1)

        top = PAGE_H - 9 * mm
        letterhead = _image(s.letterhead_path, CONTENT_W, 24 * mm)
        if letterhead:
            path, w, h = letterhead
            c.drawImage(ImageReader(io.BytesIO(path)), MX + (CONTENT_W - w) / 2, top - h, w, h, mask="auto")
        else:
            x = MX
            with_name = bool(getattr(s, "show_name_with_logo", False))
            # Wordmark logos get more room; icon logos sit beside the company name.
            logo = _image(s.logo_path, 18 * mm if with_name else 55 * mm, 16 * mm if with_name else 15 * mm)
            if logo and not with_name:
                path, w, h = logo
                c.drawImage(ImageReader(io.BytesIO(path)), x, top - h, w, h, mask="auto")
                if s.tagline:
                    c.setFont(f["sans"], 8.5)
                    c.setFillColor(MUTED)
                    c.drawString(x, top - h - 4 * mm, s.tagline)
            else:
                if logo:
                    path, w, h = logo
                    c.drawImage(ImageReader(io.BytesIO(path)), x, top - h - 1 * mm, w, h, mask="auto")
                    x += w + 4.5 * mm
                c.setFillColor(INK)
                c.setFont(f["sans_b"], 17)
                c.drawString(x, top - 7.5 * mm, s.company_name or "CraftLanee")
                if s.tagline:
                    c.setFont(f["sans"], 8.5)
                    c.setFillColor(MUTED)
                    c.drawString(x, top - 12.5 * mm, s.tagline)
            lines = []
            addr = [ln.strip() for ln in (s.address or "").splitlines() if ln.strip()]
            if addr:
                lines.append(", ".join(addr[:2]))
                if len(addr) > 2:
                    lines.append(", ".join(addr[2:4]))
            contact = "  ·  ".join(v for v in (s.phone, s.email) if v)
            if contact:
                lines.append(contact)
            if s.website:
                lines.append(s.website)
            if s.gstin:
                lines.append(f"GSTIN {s.gstin}")
            c.setFont(f["sans"], 7.8)
            c.setFillColor(MUTED)
            y = top - 3 * mm
            for ln in lines[:5]:
                c.drawRightString(PAGE_W - MX, y, ln[:95])
                y -= 3.6 * mm
        c.setStrokeColor(LINE)
        c.setLineWidth(0.7)
        c.line(MX, PAGE_H - HEADER_H + 5 * mm, PAGE_W - MX, PAGE_H - HEADER_H + 5 * mm)
        c.line(MX, FOOTER_H - 3 * mm, PAGE_W - MX, FOOTER_H - 3 * mm)
        c.setFont(f["sans"], 7.5)
        c.setFillColor(FAINT)
        c.drawString(MX, FOOTER_H - 7 * mm, "  ·  ".join(v for v in (s.company_name, s.website, s.email) if v)[:110])
        c.restoreState()


def _build(target, settings, label, story, title):
    if isinstance(target, str):
        os.makedirs(os.path.dirname(target), exist_ok=True)
    doc = BaseDocTemplate(target, pagesize=A4, leftMargin=MX, rightMargin=MX,
                          topMargin=HEADER_H, bottomMargin=FOOTER_H + 2 * mm, title=title,
                          author=settings.company_name or "CraftLanee", creator="CraftLanee")
    frame = Frame(MX, FOOTER_H + 2 * mm, CONTENT_W, PAGE_H - HEADER_H - FOOTER_H - 2 * mm,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=_Page(settings, label))])
    doc.build(story, canvasmaker=_NumberedCanvas)


# ------------------------------------------------------------------ building blocks

def _plain_table(rows, widths, extra=()):
    t = Table(rows, colWidths=widths)
    t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0), *extra]))
    return t


def ref_row(number, date_value, st):
    right = ParagraphStyle("r", parent=st["small"], alignment=TA_RIGHT)
    return _plain_table([[M(f"Ref: <b>{escape(number)}</b>", st["small"]),
                          M(f"Date: <b>{long_date(date_value)}</b>", right)]], [CONTENT_W / 2] * 2)


def section(title, st, number=None):
    label = f"{number}.&nbsp;&nbsp;{escape(title)}" if number else escape(title)
    t = Table([[M(label, st["h2"])]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([("LINEBEFORE", (0, 0), (0, 0), 2.4, ACCENT), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
    return KeepTogether([Spacer(1, 4.5 * mm), t, Spacer(1, 2.5 * mm)])


def kv_table(rows, st, label_w=58 * mm):
    data = []
    for k, v in rows:
        value = v if isinstance(v, str) and v.startswith("<rich>") else escape(str(v or "—"))
        data.append([P(k, st["label"]), M(value.replace("<rich>", ""), st["value"])])
    t = Table(data, colWidths=[label_w, CONTENT_W - label_w])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), SOFT), ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ]))
    return t


def sign_off(settings, st, salutation="Yours sincerely,", name=None, title=None):
    sig = _image(settings.signature_path, 42 * mm, 14 * mm)
    parts = [Spacer(1, 5 * mm)]
    if salutation:
        parts.append(P(salutation, st["plain"]))
    parts.append(P(f"For {settings.company_name or 'CraftLanee'}", st["strong"]))
    if sig:
        path, w, h = sig
        parts += [Spacer(1, 2 * mm), Image(io.BytesIO(path), w, h, hAlign="LEFT")]
    else:
        parts.append(Spacer(1, 13 * mm))
    parts += [P(name or settings.founder_name or "Authorised Signatory", st["strong"]),
              P(title or settings.founder_designation or "Authorised Signatory", st["small"])]
    return KeepTogether(parts)


def signature_boxes(left, right, st, settings):
    """Two signature columns, each (heading, name, title, use_company_signature)."""
    def col(heading, name, title, use_sig):
        cells = [P(heading, st["label"])]
        sig = _image(settings.signature_path, 38 * mm, 12 * mm) if use_sig else None
        if sig:
            path, w, h = sig
            cells += [Spacer(1, 1 * mm), Image(io.BytesIO(path), w, h, hAlign="LEFT")]
        else:
            cells.append(Spacer(1, 14 * mm))
        line = Table([[""]], colWidths=[62 * mm], rowHeights=[1])
        line.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.8, MUTED)]))
        return cells + [line, Spacer(1, 1.5 * mm), P(name or "", st["strong"]), P(title or "", st["small"]),
                        Spacer(1, 1.5 * mm), P("Date: ____________________", st["small"])]
    t = Table([[col(*left), col(*right)]], colWidths=[CONTENT_W / 2] * 2)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return t


def acceptance_box(heading, text, st, name=None, signer="Candidate"):
    """Tear-off style block the recipient signs and returns: statement, then separate signature,
    date and place lines with room to write, and the signer's name printed under the signature."""
    f = fonts()
    head = ParagraphStyle("ah", parent=st["tag"], textColor=ACCENT, fontSize=8, leading=11)
    cap = ParagraphStyle("ac", parent=st["tiny"], fontSize=7, leading=9.5, textColor=FAINT)
    who = ParagraphStyle("aw", parent=st["plain"], fontName=f["sans_b"], fontSize=9.5, leading=12.5, textColor=INK)
    inner = CONTENT_W - 28          # box padding
    gap = 9 * mm
    sig_w = inner * 0.46
    small_w = (inner - sig_w - 2 * gap) / 2
    fields = Table(
        [["", "", "", "", ""],
         [P(f"SIGNATURE OF {signer.upper()}", cap), "", P("DATE", cap), "", P("PLACE", cap)],
         [P(name or "", who), "", "", "", ""]],
        colWidths=[sig_w, gap, small_w, gap, small_w], rowHeights=[16 * mm, None, None])
    fields.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (0, 0), 0.9, INK), ("LINEBELOW", (2, 0), (2, 0), 0.9, INK),
        ("LINEBELOW", (4, 0), (4, 0), 0.9, INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 3), ("TOPPADDING", (0, 2), (-1, 2), 1.5),
    ]))
    title = _plain_table([[P(heading.upper(), head), P("To be signed and returned", ParagraphStyle(
        "ar", parent=cap, alignment=TA_RIGHT))]], [inner / 2] * 2, [("VALIGN", (0, 0), (-1, -1), "MIDDLE")])
    rule = Table([[""]], colWidths=[inner], rowHeights=[0.1])
    rule.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE)]))
    body = [title, Spacer(1, 2 * mm), rule, Spacer(1, 3.5 * mm), M(text, st["body"]), Spacer(1, 2 * mm), fields]
    box = Table([[body]], colWidths=[CONTENT_W])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, LINE), ("LINEABOVE", (0, 0), (-1, 0), 2.4, ACCENT),
                             ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                             ("TOPPADDING", (0, 0), (-1, -1), 11), ("BOTTOMPADDING", (0, 0), (-1, -1), 14)]))
    return KeepTogether([Spacer(1, 7 * mm), box])


def _months_between(a, b):
    if not a or not b or b < a:
        return None
    return max(1, (b.year - a.year) * 12 + (b.month - a.month) + (1 if b.day >= a.day else 0))


def _salary(amount, per="per month"):
    if not amount:
        return "Unpaid"
    return (f"<rich>{money(amount)} {per}<br/>"
            f"<font size='8' color='#5E6478'>({escape(amount_in_words(amount))})</font>")


# ------------------------------------------------------------------ documents

def offer_letter(letter, settings, target):
    st = styles()
    company = escape(settings.company_name or "CraftLanee")
    intern = letter.letter_type == "internship" or letter.employment_type in STIPEND_TYPES
    name = letter.candidate_name or "Candidate"
    role = letter.designation or ("Intern" if intern else "the offered position")
    respond_by = (letter.letter_date or date.today()) + timedelta(days=7)
    subject = "Offer of Internship" if intern else "Offer of Employment"

    story = [ref_row(letter.number, letter.letter_date, st), Spacer(1, 5 * mm),
             P("PRIVATE & CONFIDENTIAL", st["tag"]), Spacer(1, 3 * mm),
             P("To,", st["small"]), P(name, st["strong"])]
    if letter.address:
        story.append(P(letter.address, st["plain"]))
    story += [Spacer(1, 5 * mm), M(f"Subject: {subject} — {escape(role)}", st["subject"]), Spacer(1, 4 * mm),
              P(f"Dear {name.split()[0]},", st["plain"]), Spacer(1, 2.5 * mm)]
    story += rich(letter.intro, st)

    if intern:
        months = _months_between(letter.joining_date, letter.end_date)
        rows = [("Internship role", role), ("Department", letter.department),
                ("Start date", long_date(letter.joining_date)), ("End date", long_date(letter.end_date)),
                ("Duration", f"{months} month{'s' if months != 1 else ''}" if months else "—"),
                ("Monthly stipend", _salary(letter.salary)),
                ("Mentor / reporting to", letter.reporting_person), ("Work location", letter.work_location)]
        story += [section("Internship Details", st, 1), kv_table(rows, st)]
    else:
        rows = [("Designation", role), ("Department", letter.department),
                ("Employment type", letter.employment_type), ("Date of joining", long_date(letter.joining_date))]
        if letter.employment_type in FIXED_TERM_TYPES and letter.end_date:
            rows.append(("Engagement end date", long_date(letter.end_date)))
        rows += [("Reporting to", letter.reporting_person), ("Work location", letter.work_location),
                 ("Monthly gross salary", _salary(letter.salary))]
        if letter.salary and letter.employment_type in ("Full-time", "Part-time"):
            rows.append(("Annual CTC", money(float(letter.salary) * 12)))
        story += [section("Position & Compensation", st, 1), kv_table(rows, st)]

    terms = rich(letter.terms, st, mode="list")
    if terms:
        story += [section("Terms & Conditions", st, 2)] + terms
    story += [Spacer(1, 3 * mm),
              M(f"We are excited to have you join <b>{company}</b>. Please sign and return a copy of this letter "
                f"by <b>{long_date(respond_by)}</b> to confirm your acceptance. Should you have any questions, "
                "feel free to reach out to us.", st["body"]),
              sign_off(settings, st), CondPageBreak(55 * mm),
              acceptance_box("ACCEPTANCE",
                             f"I, <b>{escape(name)}</b>, have read and understood the terms of this "
                             f"{'internship offer' if intern else 'offer'} and accept them. I confirm that I will "
                             f"join on <b>{long_date(letter.joining_date)}</b>.", st, name=name,
                             signer="Intern" if intern else "Candidate")]
    _build(target, settings, letter.number, story, f"{subject} {letter.number}")


def joining_letter(letter, settings, target):
    st = styles()
    name = letter.employee_name or "Employee"
    role = letter.designation or "—"
    story = [ref_row(letter.number, letter.letter_date, st), Spacer(1, 5 * mm),
             P("To,", st["small"]), P(name, st["strong"]), P(f"Employee ID: {letter.emp_code or '—'}", st["plain"]),
             Spacer(1, 5 * mm), M(f"Subject: Confirmation of Joining — {escape(role)}", st["subject"]),
             Spacer(1, 4 * mm), P(f"Dear {name.split()[0]},", st["plain"]), Spacer(1, 2.5 * mm)]
    story += rich(letter.body, st)
    rows = [("Employee name", name), ("Employee ID", letter.emp_code), ("Designation", role),
            ("Department", letter.department), ("Employment type", letter.employment_type),
            ("Date of joining", long_date(letter.joining_date)), ("Reporting to", letter.reporting_person),
            ("Work location", letter.work_location), ("Monthly salary", _salary(letter.salary))]
    story += [section("Employment Details", st, 1), kv_table([r for r in rows if r[1]], st),
              sign_off(settings, st, "Warm regards,"), CondPageBreak(50 * mm),
              acceptance_box("ACKNOWLEDGEMENT",
                             f"I, <b>{escape(name)}</b>, acknowledge receipt of this joining letter and confirm "
                             "that the details above are correct.", st, name=name, signer="Employee")]
    _build(target, settings, letter.number, story, f"Joining Letter {letter.number}")


def _tenure(start, end):
    if not start or not end or end < start:
        return "—"
    months = (end.year - start.year) * 12 + (end.month - start.month) - (1 if end.day < start.day else 0)
    years, months = divmod(max(0, months), 12)
    parts = ([f"{years} year{'s' if years != 1 else ''}"] if years else []) + ([f"{months} month{'s' if months != 1 else ''}"] if months else [])
    return ", ".join(parts) or "Less than a month"


def relieving_letter(letter, settings, target):
    st = styles()
    name = letter.employee_name or "Employee"
    role = letter.designation or "—"
    story = [ref_row(letter.number, letter.letter_date, st), Spacer(1, 5 * mm),
             P("TO WHOMSOEVER IT MAY CONCERN", st["tag"]), Spacer(1, 3 * mm),
             P("To,", st["small"]), P(name, st["strong"]), P(f"Employee ID: {letter.emp_code or '—'}", st["plain"]),
             Spacer(1, 5 * mm), M(f"Subject: Relieving Letter — {escape(role)}", st["subject"]),
             Spacer(1, 4 * mm), P(f"Dear {name.split()[0]},", st["plain"]), Spacer(1, 2.5 * mm)]
    story += rich(letter.body, st)
    rows = [("Employee name", name), ("Employee ID", letter.emp_code), ("Designation", role),
            ("Department", letter.department), ("Employment type", letter.employment_type),
            ("Date of joining", long_date(letter.joining_date))]
    if letter.resignation_date:
        rows.append(("Resignation received", long_date(letter.resignation_date)))
    rows += [("Last working day", long_date(letter.last_working_day)),
             ("Total tenure", _tenure(letter.joining_date, letter.last_working_day))]
    story += [section("Service Details", st, 1), kv_table([r for r in rows if r[1]], st),
              Spacer(1, 4 * mm),
              P("This letter is issued on request and may be used for any official purpose.", st["small"]),
              sign_off(settings, st, "With best wishes,")]
    _build(target, settings, letter.number, story, f"Relieving Letter {letter.number}")


def _ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def mou(m, settings, target):
    st = styles()
    company = settings.company_name or "CraftLanee"
    made = m.created_at.date() if m.created_at else date.today()
    story = [Spacer(1, 1 * mm), P("MEMORANDUM OF UNDERSTANDING", st["title_c"]),
             M(f"Ref: <b>{escape(m.number)}</b>", st["sub_c"]), Spacer(1, 6 * mm),
             M(f"This Memorandum of Understanding (the “<b>MOU</b>”) is made and entered into on this "
               f"<b>{_ordinal(made.day)} day of {made.strftime('%B %Y')}</b> by and between:", st["body"])]

    def party(label, name, address, rep, alias):
        text = f"<b>{escape(name)}</b>"
        if address:
            text += f", having its office at {escape(', '.join(ln.strip().rstrip(',') for ln in address.splitlines() if ln.strip()))}"
        if rep:
            text += f", represented by {escape(rep)}"
        text += f" (hereinafter referred to as the “<b>{alias}</b>”)"
        t = Table([[P(label, st["tag"]), M(text, st["plain"])]], colWidths=[30 * mm, CONTENT_W - 30 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), SOFT),
                               ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 10),
                               ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
        return t

    rep = f"{m.signatory}, {m.signatory_designation}" if m.signatory and m.signatory_designation else m.signatory
    story += [party("FIRST PARTY", company, settings.address, rep, "First Party"), Spacer(1, 2 * mm),
              P("AND", ParagraphStyle("and", parent=st["small"], alignment=TA_CENTER)), Spacer(1, 2 * mm),
              party("SECOND PARTY", m.party_name, m.address, m.contact_person, "Second Party"), Spacer(1, 3 * mm),
              P("The First Party and the Second Party are hereinafter individually referred to as a “Party” and "
                "collectively as the “Parties”.", st["body"])]
    months = _months_between(m.start_date, m.end_date)
    story.append(kv_table([("Effective from", long_date(m.start_date)), ("Valid until", long_date(m.end_date)),
                           ("Duration", f"{months} months" if months else "—")], st))
    term_text = None
    if m.start_date or m.end_date:
        term_text = (f"<p>This MOU shall come into effect on <b>{long_date(m.start_date)}</b> and remain in force "
                     f"until <b>{long_date(m.end_date)}</b>, unless terminated earlier in accordance with this MOU "
                     "or extended by mutual written agreement of the Parties.</p>")
    clauses = [("Purpose", m.purpose, "paragraphs"), ("Scope of Work", m.scope, "paragraphs"),
               ("Term & Duration", term_text, "paragraphs"), ("Financial Terms", m.payment_terms, "paragraphs"),
               ("Roles & Responsibilities", m.responsibilities, "list"),
               ("Terms & Conditions", m.terms or settings.mou_terms, "list")]
    n = 0
    for title, text, mode in clauses:
        flow = rich(text, st, mode)
        if flow:
            n += 1
            story += [section(title, st, n)] + flow
    wit = Table([[P("Witness 1 — Name & Signature", st["small"]), P("Witness 2 — Name & Signature", st["small"])]],
                colWidths=[CONTENT_W / 2] * 2)
    wit.setStyle(TableStyle([("LINEABOVE", (0, 0), (0, 0), 0.6, LINE), ("LINEABOVE", (1, 0), (1, 0), 0.6, LINE),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 16),
                             ("TOPPADDING", (0, 0), (-1, -1), 5)]))
    story += [Spacer(1, 5 * mm),
              P("IN WITNESS WHEREOF, the Parties hereto have executed this Memorandum of Understanding through "
                "their authorised representatives on the date first written above.", st["body"]),
              CondPageBreak(75 * mm), Spacer(1, 4 * mm),
              signature_boxes((f"For {company} (First Party)", m.signatory or settings.founder_name,
                               m.signatory_designation or settings.founder_designation, True),
                              (f"For {m.party_name} (Second Party)", m.contact_person, "Authorised Signatory", False),
                              st, settings),
              KeepTogether([Spacer(1, 16 * mm), wit])]
    _build(target, settings, m.number, story, f"MOU {m.number}")


def payslip(slip, row, emp, settings, target, leave_days=0):
    st = styles()
    f = fonts()
    start, end = month_bounds(row.month)
    period = ParagraphStyle("pp", parent=st["plain"], alignment=TA_RIGHT, fontSize=12, leading=15)
    story = [_plain_table([[M("PAYSLIP", st["title"]),
                            M(f"<font size='7.5' color='#8C92A5'>PAY PERIOD</font><br/>"
                              f"<b>{escape(month_label(row.month))}</b>", period)]],
                          [CONTENT_W * 0.55, CONTENT_W * 0.45], [("VALIGN", (0, 0), (-1, -1), "BOTTOM")]),
             Spacer(1, 4 * mm)]

    key = ParagraphStyle("k", parent=st["tiny"], fontSize=7)

    def cell(k, v):
        return _plain_table([[P(k.upper(), key)], [P(v or "—", st["value"])]], [CONTENT_W / 3 - 20])

    info = [[cell("Employee name", emp.full_name), cell("Employee ID", emp.emp_code), cell("Payslip no.", slip.number)],
            [cell("Designation", emp.roles_label or emp.designation), cell("Department", emp.department),
             cell("Employment type", emp.employment_type)],
            [cell("Date of joining", long_date(emp.joining_date)), cell("Bank account", emp.masked_account),
             cell("Pay period", f"{start.strftime('%d %b')} – {end.strftime('%d %b %Y')}")]]
    grid = Table(info, colWidths=[CONTENT_W / 3] * 3)
    grid.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SOFT), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                              ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 10),
                              ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                              ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [grid, Spacer(1, 5 * mm)]

    pay_label = "Stipend" if emp.employment_type in STIPEND_TYPES else "Basic Salary"
    earnings = [(pay_label, row.basic), ("Allowances", row.allowances), ("Bonus / Incentives", row.bonus)]
    deductions = [("Deductions", row.deductions)]
    white = ParagraphStyle("w", parent=st["cellb"], textColor=colors.white, fontSize=8.5)
    whiter = ParagraphStyle("wr", parent=white, alignment=TA_RIGHT)
    table = [[P("EARNINGS", white), P("AMOUNT", whiter), P("DEDUCTIONS", white), P("AMOUNT", whiter)]]
    for i in range(max(len(earnings), len(deductions))):
        e = earnings[i] if i < len(earnings) else ("", None)
        d = deductions[i] if i < len(deductions) else ("", None)
        table.append([P(e[0], st["cell"]), P(money(e[1]) if e[1] is not None else "", st["cellr"]),
                      P(d[0], st["cell"]), P(money(d[1]) if d[1] is not None else "", st["cellr"])])
    table.append([P("Gross Earnings", st["cellb"]), P(money(row.gross), st["cellrb"]),
                  P("Total Deductions", st["cellb"]), P(money(row.deductions), st["cellrb"])])
    t = Table(table, colWidths=[CONTENT_W * 0.3, CONTENT_W * 0.2, CONTENT_W * 0.3, CONTENT_W * 0.2])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK), ("LINEBELOW", (0, 1), (-1, -2), 0.5, LINE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("LINEAFTER", (1, 0), (1, -1), 0.8, LINE),
        ("BACKGROUND", (0, -1), (-1, -1), SOFT2),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story += [t, Spacer(1, 5 * mm)]

    net_l = ParagraphStyle("nl", parent=st["plain"], textColor=colors.white, fontSize=9, leading=12.5)
    net_v = ParagraphStyle("nv", parent=st["plain"], fontName=f["sans_b"], fontSize=20, leading=24,
                           alignment=TA_RIGHT, textColor=colors.white)
    net = Table([[M(f"<b>NET PAY</b><br/><font size='8'>{escape(amount_in_words(row.net))}</font>", net_l),
                  P(money(row.net), net_v)]], colWidths=[CONTENT_W * 0.62, CONTENT_W * 0.38])
    net.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                             ("LINEBEFORE", (0, 0), (0, 0), 5, ACCENT2),
                             ("TOPPADDING", (0, 0), (-1, -1), 11), ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
                             ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12)]))
    story.append(net)
    notes = []
    if leave_days:
        notes.append(f"Approved leave this month: {leave_days:g} day{'s' if leave_days != 1 else ''}")
    if row.notes:
        notes.append(f"Note: {row.notes}")
    if notes:
        story += [Spacer(1, 3 * mm)] + [P(x, st["small"]) for x in notes]
    story += [sign_off(settings, st, salutation=""), Spacer(1, 7 * mm),
              P("This is a computer-generated payslip. For any discrepancy, please contact the company within "
                "7 days of receipt.", st["tiny"])]
    _build(target, settings, slip.number, story, f"Payslip {slip.number}")


def _qty(value):
    return f"{value.normalize():f}" if value == value.to_integral() else f"{value:.2f}".rstrip("0")


def invoice(inv, settings, target):
    st = styles()
    f = fonts()
    taxed = Decimal(inv.tax_rate or 0) > 0
    right = ParagraphStyle("ir", parent=st["plain"], alignment=TA_RIGHT, fontSize=9, leading=14)
    meta = [f"<font size='7.5' color='#8C92A5'>INVOICE NO.</font><br/><b>{escape(inv.number)}</b>",
            f"<font size='7.5' color='#8C92A5'>DATE</font>&nbsp;&nbsp;<b>{long_date(inv.invoice_date)}</b>"]
    if inv.due_date:
        meta.append(f"<font size='7.5' color='#8C92A5'>DUE</font>&nbsp;&nbsp;<b>{long_date(inv.due_date)}</b>")
    story = [_plain_table([[M("TAX INVOICE" if taxed else "INVOICE", st["title"]), M("<br/>".join(meta), right)]],
                          [CONTENT_W * 0.5, CONTENT_W * 0.5], [("VALIGN", (0, 0), (-1, -1), "BOTTOM")]),
             Spacer(1, 5 * mm)]

    # bill to
    key = ParagraphStyle("k", parent=st["tiny"], fontSize=7)
    bill = [P("BILL TO", key), P(inv.client_name, st["subject"])]
    for line in (inv.client_address, inv.client_email, inv.client_phone):
        if line:
            bill.append(P(line, st["small"]))
    if inv.client_gstin:
        bill.append(M(f"GSTIN <b>{escape(inv.client_gstin)}</b>", st["small"]))
    status_style = ParagraphStyle("stamp", parent=st["plain"], fontName=f["sans_b"], fontSize=15, leading=18,
                                  alignment=TA_CENTER, textColor=colors.HexColor("#1F9D6B") if inv.status == "paid"
                                  else colors.HexColor("#C0392B"))
    stamp = ""
    if inv.status == "paid":
        stamp = P(f"PAID{' · ' + inv.paid_date.strftime('%d %b %Y') if inv.paid_date else ''}", status_style)
    elif inv.status == "cancelled":
        stamp = P("CANCELLED", status_style)
    box = Table([[bill, stamp]], colWidths=[CONTENT_W * 0.65, CONTENT_W * 0.35])
    box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SOFT), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                             ("LINEBEFORE", (0, 0), (0, 0), 2.4, ACCENT), ("VALIGN", (0, 0), (0, 0), "TOP"),
                             ("VALIGN", (1, 0), (1, 0), "MIDDLE"),
                             ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                             ("LEFTPADDING", (0, 0), (-1, -1), 11), ("RIGHTPADDING", (0, 0), (-1, -1), 11)]))
    story += [box, Spacer(1, 6 * mm)]

    # line items
    white = ParagraphStyle("w", parent=st["cellb"], textColor=colors.white, fontSize=8.5)
    whiter = ParagraphStyle("wr", parent=white, alignment=TA_RIGHT)
    rows = [[P("#", white), P("DESCRIPTION", white), P("QTY", whiter), P("RATE", whiter), P("AMOUNT", whiter)]]
    for i, line in enumerate(inv.lines, 1):
        rows.append([P(i, st["cell"]), P(line["description"], st["cell"]), P(_qty(line["qty"]), st["cellr"]),
                     P(money(line["rate"]), st["cellr"]), P(money(line["amount"]), st["cellrb"])])
    w = CONTENT_W
    items = Table(rows, colWidths=[w * 0.06, w * 0.48, w * 0.1, w * 0.17, w * 0.19], repeatRows=1)
    items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK), ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [items, Spacer(1, 4 * mm)]

    # totals
    totals = [[P("Subtotal", st["cell"]), P(money(inv.subtotal), st["cellr"])]]
    if Decimal(inv.discount or 0) > 0:
        totals.append([P("Discount", st["cell"]), P("− " + money(inv.discount), st["cellr"])])
    if taxed:
        rate = f"{Decimal(inv.tax_rate).normalize():f}"
        label = inv.tax_label or "Tax"
        if label.upper() == "GST":  # intra-state GST splits evenly into CGST + SGST
            half = (inv.tax_amount / 2).quantize(Decimal("0.01"))
            half_rate = f"{(Decimal(inv.tax_rate) / 2).normalize():f}"
            totals += [[P(f"CGST @ {half_rate}%", st["cell"]), P(money(half), st["cellr"])],
                       [P(f"SGST @ {half_rate}%", st["cell"]), P(money(inv.tax_amount - half), st["cellr"])]]
        else:
            totals.append([P(f"{label} @ {rate}%", st["cell"]), P(money(inv.tax_amount), st["cellr"])])
    total_l = ParagraphStyle("tl", parent=st["cellb"], textColor=colors.white, fontSize=10.5)
    total_v = ParagraphStyle("tv", parent=total_l, alignment=TA_RIGHT, fontSize=13, leading=16)
    totals.append([P("TOTAL", total_l), P(money(inv.total), total_v)])
    tt = Table(totals, colWidths=[CONTENT_W * 0.24, CONTENT_W * 0.2])
    tt.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE), ("BACKGROUND", (0, -1), (-1, -1), ACCENT),
                            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                            ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    words = M(f"<font size='7' color='#8C92A5'>AMOUNT IN WORDS</font><br/>{escape(amount_in_words(inv.total))}",
              st["small"])
    story += [_plain_table([[words, tt]], [CONTENT_W * 0.56, CONTENT_W * 0.44],
                           [("VALIGN", (0, 0), (-1, -1), "TOP"), ("RIGHTPADDING", (0, 0), (0, 0), 10)])]

    if inv.notes:
        story += [section("Payment details", st), P(inv.notes, st["plain"])]
    if inv.terms:
        story += [section("Terms & conditions", st), P(inv.terms, st["small"])]
    story += [sign_off(settings, st, salutation=""), Spacer(1, 6 * mm),
              P("This is a computer-generated invoice.", st["tiny"])]
    _build(target, settings, inv.number, story, f"Invoice {inv.number}")
