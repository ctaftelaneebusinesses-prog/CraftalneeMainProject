"""Rich text for letters and MOUs.

The React editor produces a small HTML subset (bold / italic / underline, bullet & numbered
lists, alignment, font family & size). This module:

  * sanitize_html()  — keeps only that subset; everything else is dropped and its text escaped
  * rich_flowables() — renders it as ReportLab flowables with matching formatting
  * legacy plain text (no tags) still works: paragraphs, or one list item per line
"""
import re
from html import escape as html_escape
from html.parser import HTMLParser
from xml.sax.saxutils import escape

from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import ListFlowable, ListItem, Paragraph, Spacer

BLOCK = {"p", "div", "li", "h3", "h4", "blockquote"}
LISTS = {"ul", "ol"}
ALIGN = {"left", "center", "right", "justify"}
FONT_FACES = {"sans": "sans", "serif": "serif", "mono": "mono", "monospace": "mono",
              "arial": "sans", "inter": "sans", "segoe ui": "sans", "helvetica": "sans",
              "georgia": "serif", "times new roman": "serif", "cambria": "serif",
              "consolas": "mono", "courier new": "mono"}
FONT_SIZES = {"1": 8, "2": 9, "3": 10, "4": 12, "5": 14, "6": 17, "7": 21}
_ALIGN_RE = re.compile(r"text-align\s*:\s*(left|center|right|justify)", re.I)
_TAGS_RE = re.compile(r"<\s*(p|div|ul|ol|li|b|strong|i|em|u|br|font|span|h3|h4)\b", re.I)


def is_rich(text):
    return bool(text) and bool(_TAGS_RE.search(text))


def plain_to_html(text, mode="paragraphs"):
    """Convert legacy plain text into the editor's HTML."""
    text = (text or "").replace("\r\n", "\n").strip()
    if not text:
        return ""
    if mode == "list":
        items = [re.sub(r"^[\s\-•*\d.)]+", "", ln).strip() for ln in text.splitlines()]
        return "<ol>" + "".join(f"<li>{html_escape(i)}</li>" for i in items if i) + "</ol>"
    return "".join(f"<p>{html_escape(b.strip()).replace(chr(10), '<br>')}</p>"
                   for b in text.split("\n\n") if b.strip())


def _align_of(attrs):
    if attrs.get("align") in ALIGN:
        return attrs["align"]
    m = _ALIGN_RE.search(attrs.get("style") or "")
    return m.group(1).lower() if m else None


def _inline_open(tag, attrs):
    """Return (open_markup, close_markup) in the sanitised-HTML dialect, or None to ignore."""
    if tag in ("b", "strong"):
        return "<b>", "</b>"
    if tag in ("i", "em"):
        return "<i>", "</i>"
    if tag == "u":
        return "<u>", "</u>"
    if tag in ("font", "span"):
        face = FONT_FACES.get((attrs.get("face") or "").split(",")[0].strip().strip("'\"").lower())
        size = attrs.get("size") if attrs.get("size") in FONT_SIZES else None
        style = (attrs.get("style") or "").lower().replace(" ", "")
        opens, closes = [], []
        if face or size:
            bits = ([f'face="{face}"'] if face else []) + ([f'size="{size}"'] if size else [])
            opens.append(f"<font {' '.join(bits)}>"); closes.insert(0, "</font>")
        if "font-weight:bold" in style or "font-weight:700" in style:
            opens.append("<b>"); closes.insert(0, "</b>")
        if "font-style:italic" in style:
            opens.append("<i>"); closes.insert(0, "</i>")
        if "text-decoration:underline" in style or "text-decoration-line:underline" in style:
            opens.append("<u>"); closes.insert(0, "</u>")
        return "".join(opens), "".join(closes)
    return None


# ------------------------------------------------------------------ sanitiser

class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.stack = []  # (tag, closing markup)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "br":
            self.out.append("<br>")
        elif tag in BLOCK:
            align = _align_of(a)
            self.out.append(f'<{tag} style="text-align:{align}">' if align else f"<{tag}>")
            self.stack.append((tag, f"</{tag}>"))
        elif tag in LISTS:
            self.out.append(f"<{tag}>")
            self.stack.append((tag, f"</{tag}>"))
        else:
            pair = _inline_open(tag, a)
            if pair:
                self.out.append(pair[0])
                self.stack.append((tag, pair[1]))
        # anything else (script, style, img, a, table…) is dropped; its text is escaped below

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for _, close in reversed(self.stack[i:]):
                    self.out.append(close)
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.out.append(html_escape(data, quote=False))

    def result(self):
        for _, close in reversed(self.stack):
            self.out.append(close)
        return "".join(self.out)


def sanitize_html(html, max_len=40000):
    if not html or not html.strip():
        return ""
    if not is_rich(html):
        return plain_to_html(html)[:max_len]
    p = _Sanitizer()
    p.feed(html[: max_len * 2])
    p.close()
    return p.result()[:max_len]


# ------------------------------------------------------------------ HTML → ReportLab

_RL_ALIGN = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT, "justify": TA_JUSTIFY}


class _Builder(HTMLParser):
    def __init__(self, styles, fonts):
        super().__init__(convert_charrefs=True)
        self.st, self.fonts = styles, fonts
        self.flow = []
        self.lists = []          # stack of {"type", "items": [[flowables], ...]}
        self.buf = []
        self.open = []           # open inline tags: (tag, open_markup, close_markup)
        self.align_stack = [None]
        self.n = 0

    def _target(self):
        if self.lists and self.lists[-1]["items"]:
            return self.lists[-1]["items"][-1]
        return self.flow

    def _flush(self):
        text = "".join(self.buf).strip()
        self.buf = [o for _, o, _ in self.open]  # carry open inline formatting into the next paragraph
        if not re.sub(r"<[^>]+>", "", text).strip():
            if not self.lists and self.flow and not isinstance(self.flow[-1], Spacer):
                self.flow.append(Spacer(1, 5))
            return
        text += "".join(c for _, _, c in reversed(self.open))
        base = self.st["item"] if self.lists else self.st["body"]
        align = _RL_ALIGN.get(self.align_stack[-1], base.alignment)
        self.n += 1
        style = ParagraphStyle(f"rt{self.n}", parent=base, alignment=align)
        try:
            para = Paragraph(text, style)
        except ValueError:  # malformed markup — fall back to plain text
            para = Paragraph(escape(re.sub(r"<[^>]+>", "", text)), style)
        self._target().append(para)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in BLOCK:
            self._flush()
            align = _align_of(a)
            self.align_stack.append(align or self.align_stack[-1])
            if tag == "li" and self.lists:
                self.lists[-1]["items"].append([])
            if tag in ("h3", "h4"):
                self._push("b", "<b>", "</b>")
        elif tag in LISTS:
            self._flush()
            self.lists.append({"type": tag, "items": []})
        elif tag == "br":
            self.buf.append("<br/>")
        elif tag in ("b", "strong"):
            self._push(tag, "<b>", "</b>")
        elif tag in ("i", "em"):
            self._push(tag, "<i>", "</i>")
        elif tag == "u":
            self._push(tag, "<u>", "</u>")
        elif tag == "font":
            bits = []
            if a.get("face") in ("sans", "serif", "mono"):
                bits.append(f'name="{self.fonts[a["face"]]}"')
            if a.get("size") in FONT_SIZES:
                bits.append(f'size="{FONT_SIZES[a["size"]]}"')
            self._push(tag, f"<font {' '.join(bits)}>" if bits else "", "</font>" if bits else "")

    def _push(self, tag, o, c):
        self.open.append((tag, o, c))
        self.buf.append(o)

    def handle_endtag(self, tag):
        if tag in BLOCK:
            if tag in ("h3", "h4"):
                self._pop("b")
            self._flush()
            if len(self.align_stack) > 1:
                self.align_stack.pop()
        elif tag in LISTS and self.lists:
            self._flush()
            lst = self.lists.pop()
            items = [ListItem(fl, leftIndent=16) for fl in lst["items"] if fl]
            if items:
                kw = (dict(bulletType="1", bulletFormat="%s.") if lst["type"] == "ol"
                      else dict(bulletType="bullet", start="•"))
                self._target().append(ListFlowable(
                    items, leftIndent=16, bulletFontName=self.fonts["sans"], bulletFontSize=9.5,
                    bulletColor=self.st["bullet_color"], spaceAfter=6, **kw))
        else:
            self._pop({"strong": "b", "em": "i"}.get(tag, tag), alt=tag)

    def _pop(self, tag, alt=None):
        for i in range(len(self.open) - 1, -1, -1):
            if self.open[i][0] in (tag, alt):
                closes = "".join(c for _, _, c in reversed(self.open[i:]))
                reopen = "".join(o for _, o, _ in self.open[i + 1:])
                self.buf.append(closes + reopen)
                del self.open[i]
                return

    def handle_data(self, data):
        if not data.strip() and not "".join(self.buf).strip():
            return
        self.buf.append(escape(data.replace("\n", " ")))

    def result(self):
        self._flush()
        while self.lists:
            self.handle_endtag(self.lists[-1]["type"])
        while self.flow and isinstance(self.flow[-1], Spacer):
            self.flow.pop()
        return self.flow


def rich_flowables(value, styles, fonts, mode="paragraphs"):
    """Render stored letter / MOU text (rich HTML or legacy plain text) as flowables."""
    if not value or not value.strip():
        return []
    html = sanitize_html(value) if is_rich(value) else plain_to_html(value, mode)
    b = _Builder(styles, fonts)
    b.feed(html)
    b.close()
    return b.result()
