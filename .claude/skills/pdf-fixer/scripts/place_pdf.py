#!/usr/bin/env python3
"""Render one page: the original image (visible, unchanged) + a LINE-STRUCTURED
invisible text layer that mimics how a real OCR PDF is built, so PDF viewers do
proper column-aware mouse selection (select the left column and it stays in the
left column; drag into the right column and it flows in reading order).

How:
  - tesseract hOCR groups words into lines (ocr_line) within column blocks
    (ocr_carea). We draw **one text run per line**, positioned at the line's box and
    horizontally scaled to its width — this is what gives viewers real "lines" to
    group into columns (drawing isolated per-word fragments does not).
  - Each line's word text is corrected from text-clean (the vision-cleaned page).
  - The lines are ORDERED by the cleaned reading order (each line ranked by where its
    words fall in text-clean), so `pdftotext -raw` / copy and selection follow the
    human reading order — not tesseract's raw order.
  - Cleaned words with no hOCR line (a page whose text was reconstructed from the
    image — maps, covers) are appended as a reading-order fallback flow so they stay
    searchable.

Usage:
  place_pdf.py <page-image> <text-clean.md> <page.hocr> <out.pdf> [dpi=200] [visible-jpeg]
"""

import os
import re
import sys
import tempfile
from collections import defaultdict, deque
from difflib import get_close_matches

from lxml import etree
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

_BBOX = re.compile(r"bbox (\d+) (\d+) (\d+) (\d+)")
_MD = re.compile(r"[`*_#>|]|~~")
# soft/discretionary hyphen + zero-width chars (render as stray "-"); fold
# super/subscript digits to ASCII (base font can't encode them).
_ZAP = str.maketrans(
    {
        "­": None, "​": None, "‌": None, "﻿": None,
        "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
        "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
        "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
        "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
    }
)


# fold Swedish/foreign diacritics so an OCR word matches its accent-corrected form
# (e.g. "fran" <-> "från", "Forbund" <-> "Förbund").
_FOLD = str.maketrans("åäöáàâéèêëíìîïóòôøúùûüçñ", "aaoaaaeeeeiiiioooouuuucn")


def normalize(t: str) -> str:
    return re.sub(r"[^\w]", "", t.lower().translate(_FOLD))


def wordlike(s: str) -> bool:
    return bool(re.search(r"[^\W\d_]{2,}", s))


def bbox(el):
    m = _BBOX.search(el.get("title") or "")
    return tuple(int(x) for x in m.groups()) if m else None


def parse_lines(hocr_path: str):
    """Return [(line_bbox, [(raw_word, wbbox), ...]), ...] in hOCR document order."""
    tree = etree.parse(hocr_path, etree.HTMLParser(encoding="utf-8"))
    lines = []
    for line_el in tree.getroot().iter():
        if line_el.get("class") not in ("ocr_line", "ocr_textline", "ocr_header", "ocr_caption"):
            continue
        lb = bbox(line_el)
        words = []
        for w in line_el.iter():
            if w.get("class") != "ocrx_word":
                continue
            wb = bbox(w)
            txt = "".join(w.itertext()).strip().translate(_ZAP)
            if wb and txt:
                words.append((txt, wb))
        if lb and words:
            lines.append((lb, words))
    return lines


def clean_tokens(text_path: str):
    with open(text_path, encoding="utf-8") as fh:
        return _MD.sub(" ", fh.read().translate(_ZAP)).split()


def make_visible(img_path, visible, out_path):
    tmp = None
    q = int(os.environ.get("PDF_FIXER_JPEG_QUALITY", "90"))
    if visible and visible.lower().endswith((".jpg", ".jpeg")):
        return visible, None
    if q > 0:
        with Image.open(visible or img_path) as sim:
            rgb = sim.convert("L" if sim.mode in ("L", "1", "LA") else "RGB")
        fd, tmp = tempfile.mkstemp(suffix=".jpg", dir=os.path.dirname(out_path) or ".")
        os.close(fd)
        rgb.save(tmp, "JPEG", quality=q, optimize=True)
        return ImageReader(tmp), tmp
    return visible or img_path, None


def main() -> int:
    if len(sys.argv) not in (5, 6, 7):
        sys.stderr.write(__doc__ or "")
        return 2
    img_path, text_path, hocr_path, out_path = sys.argv[1:5]
    dpi = float(sys.argv[5]) if len(sys.argv) >= 6 else 200.0
    visible = sys.argv[6] if len(sys.argv) >= 7 else None
    f = 72.0 / dpi

    with Image.open(img_path) as im:
        px_w, px_h = im.size
    width, height = px_w * f, px_h * f

    # Word boxes (position source), keyed by normalized text for content-matching.
    boxes = [(txt, wb) for _lb, words in parse_lines(hocr_path) for txt, wb in words]
    clean = clean_tokens(text_path)
    pool: dict[str, deque[int]] = defaultdict(deque)
    for i, (txt, _wb) in enumerate(boxes):
        pool[normalize(txt)].append(i)

    def box_for(tok):
        """Find the scan box for a cleaned token by content (diacritic-folded, then
        fuzzy). Returns the box bbox or None."""
        key = normalize(tok)
        if key and pool.get(key):
            return boxes[pool[key].popleft()][1]
        if key:
            avail = [k for k, d in pool.items() if d and k]
            near = get_close_matches(key, avail, n=1, cutoff=0.80)
            if near:
                return boxes[pool[near[0]].popleft()][1]
        return None

    # CONTENT + ORDER come from text-clean (authoritative, vision-cleaned). We rebuild
    # LINES from the matched box rows so viewers do column-aware selection: a run of
    # consecutive cleaned tokens whose boxes share a row (and go left-to-right) is one
    # line. A token with no box (heavy correction) flows into the current line;
    # tokens before any box start (fully reconstructed pages) go to a fallback flow.
    lines = []                 # (x0,y0,x1,y1, [tokens])
    cur = None
    fallback = []
    for tok in clean:
        b = box_for(tok)
        if b is None:
            if cur is not None:
                cur[4].append(tok)      # flow into current line
            else:
                fallback.append(tok)
            continue
        x0, y0, x1, y1 = b
        same_row = False
        if cur is not None:
            overlap = min(y1, cur[3]) - max(y0, cur[1])          # vertical overlap
            minh = min(y1 - y0, cur[3] - cur[1]) or 1
            # same line: boxes share a row AND the new word is to the right of the
            # current line end (so a word starting back at the left is a new line).
            same_row = overlap > 0.4 * minh and x0 >= cur[2] - 0.5 * (y1 - y0)
        if same_row:
            cur[4].append(tok)
            cur[2] = max(cur[2], x1)                             # extend right edge only
        else:
            if cur is not None:
                lines.append(cur)
            cur = [x0, y0, x1, y1, [tok]]
    if cur is not None:
        lines.append(cur)

    c = canvas.Canvas(out_path, pagesize=(width, height))
    draw, tmp_jpeg = make_visible(img_path, visible, out_path)
    c.drawImage(draw, 0, 0, width=width, height=height)

    t = c.beginText()
    t.setTextRenderMode(3)  # invisible
    for x0, y0, x1, y1, toks in lines:
        text = " ".join(toks)
        size = max(1.0, (y1 - y0) * f)
        box_w = max(1.0, (x1 - x0) * f)
        natural = c.stringWidth(text, "Helvetica", size) or 1.0
        # If the cleaned line is wider than its box, shrink the FONT to fit rather than
        # compress horizontally — horizontal compression collapses the spaces and
        # pdftotext then glues the words together.
        if natural > box_w:
            size = max(1.0, size * box_w / natural)
            natural = c.stringWidth(text, "Helvetica", size) or 1.0
        t.setFont("Helvetica", size)
        t.setTextOrigin(x0 * f, height - y1 * f)
        t.setHorizScale(100.0 * box_w / natural)
        try:
            t.textLine(text)
        except Exception:
            pass
        t.setHorizScale(100.0)

    # Fallback flow for reconstructed text with no scan boxes (maps, covers).
    if fallback:
        mx, my = 0.04 * width, 0.04 * height
        fsize, fx, fy = 10.0, 0.04 * width, height - 0.04 * height
        t.setFont("Helvetica", fsize)
        for tok in fallback:
            w = c.stringWidth(tok, "Helvetica", fsize) or fsize
            if fx + w > width - mx:
                fx, fy = mx, fy - fsize * 1.2
            t.setTextOrigin(fx, fy)
            try:
                t.textOut(tok + " ")
            except Exception:
                pass
            fx += w + fsize * 0.25

    c.drawText(t)
    c.showPage()
    c.save()
    if tmp_jpeg:
        os.unlink(tmp_jpeg)
    placed = sum(len(ln[4]) for ln in lines)
    sys.stderr.write(
        f"place_pdf: {len(lines)} lines, {placed}/{len(clean)} tokens in lines, "
        f"{len(fallback)} in fallback -> {out_path}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
