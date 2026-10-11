"""Facts a create agent would otherwise have to measure in pixels.

Only useful for born-digital issues (meta.env KIND=digital).
There the PDF carries a real text layer, so three things that cost vision work
on a scan are answerable from the bytes:

  * TRUE hyphens. extract.sh writes text/ with plain `pdftotext`, which
    de-hyphenates: it silently joins `SSF-` + `medlemmarna` into
    `SSFmedlemmarna` and `5-` + `10` into `510`, leaving nothing to notice.
    Measured on 2007-1: 10 line-end hyphens survive in text/, 170 with
    -layout. So text/ is a READING-ORDER hint only; this file is the
    character truth.
  * Emphasis and heading rank. Bold/italic are font names, not stem widths;
    heading rank is a point size. pdfminer exposes both per character.
  * Which glyph is actually printed - en dash vs hyphen, curly vs straight
    quote - is just the codepoint.

What it CANNOT answer, and still needs the page image: reading order across
columns (pdftotext interleaves the two folios of a spread on 5-14 of every 25
pages, and emits tables column-major), underline (a drawn rule, not a font),
and anything about a photograph.

    python3 pagefacts.py <ISSUE> <PAGE>            # text + non-body font runs + glyphs
    python3 pagefacts.py <ISSUE> <PAGE> --text     # hyphen-true text only
    python3 pagefacts.py <ISSUE> <PAGE> --spans    # [font@size] runs only
"""

import argparse
import re
import subprocess
import sys
import unicodedata
from collections import Counter

import roots

# Codepoints worth reporting when present: each one is a judgement call that
# used to be made by measuring a glyph.
NOTABLE = {
    "‐": "U+2010 hyphen",
    "‑": "U+2011 non-breaking hyphen",
    "‒": "U+2012 figure dash",
    "–": "U+2013 EN DASH",
    "—": "U+2014 EM DASH",
    "―": "U+2015 horizontal bar",
    "‘": "U+2018 curly single open",
    "’": "U+2019 curly single close / apostrophe",
    "“": "U+201C curly double open",
    "”": "U+201D curly double close",
    "„": "U+201E low double",
    '"': "U+0022 STRAIGHT double",
    "'": "U+0027 STRAIGHT single",
    "«": "U+00AB guillemet open",
    "»": "U+00BB guillemet close",
    "°": "U+00B0 degree",
    "º": "U+00BA masculine ordinal (often a mis-set degree)",
    "Ω": "U+03A9 OMEGA dingbat",
    "­": "U+00AD SOFT HYPHEN - must not reach the deliverable",
    " ": "U+00A0 no-break space - normalise",
    "�": "U+FFFD REPLACEMENT CHAR - broken ToUnicode, reconstruct the word",
}
SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹"


def issue_dir(name):
    work = roots.require_work()
    exact = work / name
    if exact.is_dir():
        return exact
    hits = sorted(p for p in work.iterdir() if p.is_dir() and name.lower() in p.name.lower())
    if not hits:
        sys.exit(f"no issue matching {name!r} under {work}")
    if len(hits) > 1:
        sys.exit("ambiguous:\n  " + "\n  ".join(p.name for p in hits))
    return hits[0]


def meta(d):
    f = d / "meta.env"
    if not f.is_file():
        return {}
    return dict(
        line.split("=", 1) for line in f.read_text().splitlines() if "=" in line
    )


def layout_text(pdf, page):
    """pdftotext -layout: keeps the line-end hyphen that plain pdftotext eats."""
    out = subprocess.run(
        ["pdftotext", "-layout", "-f", str(page), "-l", str(page), str(pdf), "-"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"pdftotext failed: {out.stderr.strip()}")
    return out.stdout


def spans(pdf, page):
    """[(fontname, size, x0, y0, text)] in pdfminer's layout order.

    x0 is what tells a spread apart: on an 839 pt page everything below the
    midline is the left folio, everything above it the right one.
    """
    try:
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LAParams, LTChar, LTTextContainer
    except ImportError:
        sys.exit("pdfminer.six is not installed; --spans unavailable")

    runs = []
    size_of_page = None
    for layout in extract_pages(str(pdf), page_numbers=[page - 1], laparams=LAParams()):
        size_of_page = (layout.width, layout.height)
        for element in layout:
            if not isinstance(element, LTTextContainer):
                continue
            for line in element:
                if not hasattr(line, "__iter__"):
                    continue
                for ch in line:
                    text = ch.get_text() if hasattr(ch, "get_text") else ""
                    if not isinstance(ch, LTChar):
                        # LTAnno: a space or newline pdfminer infers between
                        # glyphs. It carries no font, so it extends the run in
                        # progress rather than breaking it.
                        if runs and text:
                            runs[-1][-1].append(text)
                        continue
                    key = (ch.fontname.split("+")[-1], round(ch.size, 1))
                    if runs and tuple(runs[-1][:2]) == key:
                        runs[-1][-1].append(text)
                    else:
                        runs.append([key[0], key[1], round(ch.x0), round(ch.y0), [text]])
            runs.append(["", 0.0, 0, 0, ["\n"]])  # block break
        break
    return size_of_page, [(f, s, x, y, "".join(t)) for f, s, x, y, t in runs if f]


def folio_split(size_of_page, runs):
    """(is_spread, midline, {'L': [folio…], 'R': [folio…]}).

    A folio number is a short bare integer set apart from the text — near the
    foot or head of its own half. Report candidates rather than pick one: the
    agent confirms against the image.
    """
    if not size_of_page:
        return False, 0.0, {}
    width, height = size_of_page
    is_spread = width > height * 1.3
    mid = width / 2
    cand = {"L": [], "R": []}
    for _f, _s, x, y, text in runs:
        t = text.strip()
        if t.isdigit() and len(t) <= 3:
            half = "L" if not is_spread or x < mid else "R"
            cand[half].append((int(t), x, y))
    return is_spread, mid, cand


def classify(font):
    f = font.lower()
    bold = "bold" in f or "black" in f or "semibold" in f or "heavy" in f
    italic = "italic" in f or "oblique" in f
    if bold and italic:
        return "BOLD+ITALIC"
    return "BOLD" if bold else "ITALIC" if italic else "regular"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("issue")
    ap.add_argument("page", type=int, help="1-based PDF page (same NN as pages/page-NN.png)")
    ap.add_argument("--text", action="store_true", help="hyphen-true text only")
    ap.add_argument("--spans", action="store_true", help="font/size runs only")
    a = ap.parse_args()

    d = issue_dir(a.issue)
    pdf = d / "original.pdf"
    if not pdf.is_file():
        sys.exit(f"no original.pdf in {d}")
    m = meta(d)
    kind = m.get("KIND", "?")

    only = a.text or a.spans
    if not only:
        print(f"# {d.name}  page {a.page}  (KIND={kind}, PAGES={m.get('PAGES','?')})")
        if kind != "digital":
            print("# WARNING: KIND is not 'digital' - on a scan the text layer is OCR,")
            print("#          so none of the below is character truth. Use the image.")
        print()

    if not a.spans:
        text = layout_text(pdf, a.page)
        if not only:
            ends = len(re.findall(r"[^\W\d_]-$", text, re.MULTILINE))
            print(f"## hyphen-true text  (pdftotext -layout; {ends} line-end hyphens kept)")
            print("## text/page-NN.md has these REMOVED and the words fused - never")
            print("## take a compound or a number range from that file.")
            print()
        if not only:
            # -layout pads columns with long space runs; shrink them to a
            # visible column gap so the hyphen-true text costs a third as much.
            text = "\n".join(re.sub(r" {4,}", "   ", ln).rstrip() for ln in text.splitlines())
        print(text.rstrip("\n"))
        if not only:
            print()

    if not a.text:
        size_of_page, runs = spans(pdf, a.page)
        is_spread, mid, cand = folio_split(size_of_page, runs)
        if not only:
            w, h = size_of_page or (0, 0)
            print(f"## page geometry: {w:.0f} x {h:.0f} pt — "
                  + ("TWO-FOLIO SPREAD" if is_spread else "single folio"))
            if is_spread:
                print(f"## midline x={mid:.0f}: spans marked [L] are the LEFT folio, [R] the RIGHT.")
                print("## Transcribe the WHOLE [L] folio, then the WHOLE [R] folio, and put a")
                print("## page marker at the top of each — see the page-marker rule.")
            for half in ("L", "R") if is_spread else ("L",):
                nums = sorted({n for n, _x, _y in cand.get(half, [])})
                label = f"{half} folio" if is_spread else "folio"
                print(f"## {label} — bare-integer candidates (the printed folio is usually one of"
                      f" these, at the foot): {nums or 'none found'}")
            print()
            print("## emphasis + heading rank  (font name = emphasis, size = rank)")
            sizes = Counter(round(s) for _f, s, _x, _y, t in runs if t.strip())
            if sizes:
                body = sizes.most_common(1)[0][0]
                print(f"## dominant size {body} pt = body text; larger = heading, in order:")
                for s, n in sorted(sizes.items(), reverse=True):
                    if s > body:
                        print(f"##   {s} pt ({n} chars)")
            print()
        # Default view lists only the runs that DIFFER from the body font: the
        # body text is already in the hyphen-true section above, and repeating
        # it here tripled the output on every page (--spans keeps the full list).
        body_key = None
        if not only:
            weight = Counter()
            for font, size, _x, _y, text in runs:
                weight[(font, size)] += len(text.strip())
            if weight:
                body_key = weight.most_common(1)[0][0]
                print(f"## body font {body_key[0]}@{body_key[1]} omitted below; "
                      "only bold/italic/heading/other runs are listed (--spans = all)")
        for font, size, x, _y, text in runs:
            if not text.strip():
                continue
            if body_key and (font, size) == body_key:
                continue
            mark = classify(font)
            flag = "" if mark == "regular" else f"  <- {mark}"
            half = ("[L] " if x < mid else "[R] ") if is_spread else ""
            print(f"{half}[{font}@{size}] {text.strip()}{flag}")

    if not only:
        print()
        print("## glyphs present  (decide dash/quote style by CODEPOINT, never by eye)")
        text = layout_text(pdf, a.page)
        found = False
        for ch, label in NOTABLE.items():
            n = text.count(ch)
            if n:
                found = True
                print(f"  {n:4d}  {label}")
        sup = sum(text.count(c) for c in SUPERSCRIPT)
        if sup:
            print(f"  {sup:4d}  superscript digits (m2/m3, or a raised clock time - keep verbatim)")
        priv = sorted({c for c in text if "" <= c <= ""})
        if priv:
            found = True
            print("  private-use glyphs (a dingbat font; render as a note in the content language, not as junk):")
            for c in priv:
                print(f"      U+{ord(c):04X}")
        if not found and not sup:
            print("  (none - plain hyphens and straight quotes only)")


if __name__ == "__main__":
    main()
