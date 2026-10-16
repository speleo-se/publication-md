#!/usr/bin/env python3
"""Hygiene-check a unit's page files (the deliverable <name>-content/, the only copy) and
refresh its generated navigation lines.

    python3 finalize.py 1987_2            # checks (+ rewrites only the navigation lines)
    python3 finalize.py 1987_2 --join     # + join cross-page hyphenation first

`--sync` is accepted for old prompts and does nothing extra: there is no work copy to copy.

Run --join ONCE, before reviews. Do NOT re-run it after you have manually fixed a
join: it can re-create a bad join (a page-final fragment that is a truncated caption
rather than a real continuation gets fused into a fabricated word).
"""

import argparse
from collections import Counter
import re
import subprocess
import sys
from pathlib import Path

import roots
from roots import WORK as SRC, CONTENT as DST

# Sibling skill, resolved relative to this file: <root>/.claude/skills/pdf-extract/...
JOIN = Path(__file__).resolve().parents[2] / "pdf-extract" / "scripts" / "join_pagebreaks.py"

SOFT_HYPHEN = "­"
RE_ENTITY = re.compile(r"&[a-zA-Z]+;|&#[0-9]+;")
RE_TAG = re.compile(r"</?(u|b|i|content|page|result|output)>")
RE_DANGLING = re.compile(r"[^\W\d_]-\s*$")  # any letter, any alphabet
RE_SEP = re.compile(r"^\s*\|[\s:|-]+\|\s*$")
RE_FOLIO = re.compile(r"^\d{1,3}$")
# The page marker says which PRINTED page (its label, as printed: 12, iv, Omslag)
# the following content came from — never the pageIndex, which is the file name.
# Needed because a born-digital page is often a spread carrying two folios in one
# file, and the downstream use is cropping an article out by its TOC page number.
RE_PAGEMARK = re.compile(r"<!--\s*page:\s*([^\s][^\n]*?)\s*-->")
# publication-md metadata blocks (schema/README.md in the content repo): single-line
# YAML payloads. Only their shape is checked here; validate.ts checks the content.
RE_METABLOCK = re.compile(r"<!--\s*(part|figure|note):[^\n]*?-->")
# Anything comment-shaped that is neither of those is a typo in a marker.
RE_COMMENTISH = re.compile(r"<!--.*?-->", re.S)
# The publication-md validator (Node) lives in this repo, next to the skills.
VALIDATE = roots.ROOT / "tools" / "validate.ts"


def resolve(token):
    roots.require_work()
    hits = [p for p in SRC.iterdir()
            if p.is_dir() and roots.is_unit(p.name) and token in p.name]
    if not hits:
        sys.exit(f"no issue matching {token!r} under {SRC}")
    if len(hits) > 1:
        sys.exit("ambiguous: " + ", ".join(sorted(p.name for p in hits)))
    return hits[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("issue")
    ap.add_argument("--join", action="store_true", help="run join_pagebreaks.py first (once!)")
    ap.add_argument("--sync", action="store_true", help="no-op (kept for old prompts)")
    a = ap.parse_args()

    d = resolve(a.issue)
    dst = roots.pages_dir(d.name)
    npages = len(list((d / "pages").glob("page-*.png")))
    print(f"issue: {d.name}  ({npages} page images)")

    if a.join:
        print("\n--- join_pagebreaks ---")
        # join_pagebreaks looks at each file's last line: take the navigation lines off first
        # (run_nav puts them back below).
        for f in dst.glob("pageIndex-*.md"):
            f.write_text(roots.read_page(f), encoding="utf-8")
        subprocess.run([sys.executable, str(JOIN), str(dst)], check=True)

    files = sorted(dst.glob("pageIndex-*.md"))
    print(f"\n--- counts ---\npage files: {len(files)}/{npages}  ({dst})")
    problems = []
    incomplete = []
    if len(files) != npages:
        incomplete.append(f"{dst.name} has {len(files)} page files, expected {npages}")
    expected = {f"pageIndex-{i:03d}.md" for i in range(npages)}
    missing = sorted(expected - {f.name for f in files})
    if missing:
        incomplete.append(f"missing: {', '.join(missing[:10])}")
    problems += incomplete

    # A printed folio is not always the LAST line: when a figure/photo note follows it,
    # a trailing-line-only check is blind to it. Collect every standalone bare number,
    # then keep the ones whose value tracks the scan number (page index + 1) with the
    # issue's dominant offset — inserts shift the folio, so the offset need not be 0.
    # Map labels and scale figures (a bare "1" beside "0 250 500m") do NOT track it.
    bare = []
    for f in files:
        idx = int(f.stem.split("-")[1])
        for i, ln in enumerate(roots.read_page(f).split("\n"), 1):
            if RE_FOLIO.match(ln.strip()):
                bare.append((f.name, i, int(ln.strip()), int(ln.strip()) - (idx + 1)))
    stray = []
    if bare:
        counts = Counter(off for *_, off in bare)
        dom, hits = counts.most_common(1)[0]
        if hits >= 2 or dom == 0:
            stray = [f"{n}:{i}: '{v}' (folio, offset {off:+d})"
                     for n, i, v, off in bare if off == dom]

    dangling, soft, ents, tags, tables, placeholders, folios = [], [], [], [], [], [], []
    badmark, seen_marks = [], []  # page markers: malformed, and (file, folio) in order
    for f in files:
        text = roots.read_page(f)
        lines = text.split("\n")
        # Only numeric labels take part in the order/climb checks; a label like
        # "Omslag" or "iv" is validated against pageSequence by validate.ts instead.
        marks = [int(m.group(1).strip("'\"")) for m in RE_PAGEMARK.finditer(text)
                 if m.group(1).strip("'\"").isdigit()]
        seen_marks.extend((f.name, n) for n in marks)
        for m in RE_COMMENTISH.finditer(text):
            if not (RE_PAGEMARK.fullmatch(m.group(0)) or RE_METABLOCK.fullmatch(m.group(0))):
                badmark.append(f"{f.name}: {m.group(0)[:50]!r} — the only comments allowed "
                               "are single-line <!-- page|part|figure|note: … --> "
                               "(old spelling <!-- page N --> is now <!-- page: N -->)")
        if sorted(marks) != marks:
            badmark.append(f"{f.name}: page markers out of order {marks}")
        tail = [ln for ln in lines if ln.strip()]
        if tail and RE_FOLIO.match(tail[-1].strip()):
            folios.append(f"{f.name}: trailing '{tail[-1].strip()}'")
        if SOFT_HYPHEN in text:
            soft.append(f.name)
        for m in RE_ENTITY.finditer(text):
            ents.append(f"{f.name}: {m.group(0)}")
        for m in RE_TAG.finditer(text):
            tags.append(f"{f.name}: {m.group(0)}")
        for i, ln in enumerate(lines, 1):
            if ln.lstrip().startswith("|"):
                continue
            if RE_DANGLING.search(ln):
                dangling.append(f"{f.name}:{i}: ...{ln.strip()[-60:]}")
        i = 0
        while i < len(lines):
            if lines[i].lstrip().startswith("|"):
                j = i
                while j < len(lines) and lines[j].lstrip().startswith("|"):
                    j += 1
                if j - i >= 2 and not RE_SEP.match(lines[i + 1]):
                    tables.append(f"{f.name}:{i + 1}")
                i = j
            else:
                i += 1
        idx = int(f.stem.split("-")[1])
        raw = d / "text" / f"page-{idx + 1:02d}.md"
        if raw.is_file() and text.rstrip("\n") == raw.read_text(encoding="utf-8").rstrip("\n"):
            placeholders.append(f.name)

    def report(label, items, note=""):
        print(f"\n--- {label} ---")
        if items:
            for x in items[:25]:
                print(f"  {x}")
            if len(items) > 25:
                print(f"  ... and {len(items) - 25} more")
            if note:
                print(f"  NOTE: {note}")
        else:
            print("  (none)")
        return items

    # Across the issue the printed folios must climb. A file that jumps backwards,
    # repeats a folio, or skips one usually means a spread was split at the wrong
    # place or a folio was misread — both invisible to every other check here.
    for (fa, na), (fb, nb) in zip(seen_marks, seen_marks[1:]):
        if nb <= na:
            badmark.append(f"{fb}: page {nb} does not follow page {na} in {fa}")
        elif nb != na + 1:
            badmark.append(f"{fb}: page {nb} skips {nb - na - 1} after page {na} in {fa}")

    report("still raw OCR (placeholder — MUST be redone)", placeholders)
    report("page markers", badmark,
           "one <!-- page: N --> at the start of each printed page's content; a "
           "two-folio spread carries two, in reading order")
    report("soft hyphens (U+00AD)", soft)
    report("HTML entities", ents)
    report("HTML tags", tags)
    report("malformed table blocks (2nd line not a separator)", tables)
    report("trailing printed folio (page number)", folios,
           "corpus convention is to DROP the printed folio — delete these lines")
    report("stray printed folio lines (anywhere in the file)", stray,
           "the trailing-line check cannot see a folio that sits before a figure note — "
           "delete these lines; a bare number that is a map label or scale must be KEPT")
    report("dangling hyphens", dangling,
           "each must be a genuine page-final fragment continuing on the NEXT page; "
           "if a figure/photo note sits after it, join_pagebreaks CANNOT reach it — join by hand")

    # Full publication-md validation (YAML payloads, part keys, figure placement, image
    # paths) is one implementation shared with the Speleotastic import: validate.ts.
    print("\n--- publication-md ---")
    if not VALIDATE.is_file():
        print(f"  skipped: {VALIDATE} not found")
    elif not (roots.ROOT / "node_modules" / "yaml").is_dir():
        print(f"  skipped: run `npm install` in {roots.ROOT} to enable the metadata validator")
    else:
        r = subprocess.run(["node", str(VALIDATE), "--errors-only", str(dst)],
                           capture_output=True, text=True)
        out = [ln for ln in r.stdout.splitlines() if ln.strip()]
        for ln in out[:-1][:25]:
            print(f"  {ln}")
        print(f"  {out[-1] if out else r.stderr.strip()[:200]}")
        if r.returncode:
            problems.append("publication-md validation failed")

    problems += [f"{len(placeholders)} placeholder page(s)"] if placeholders else []
    problems += [f"{len(soft)} file(s) with soft hyphens"] if soft else []
    problems += [f"{len(ents)} HTML entity/entities"] if ents else []
    problems += [f"{len(tags)} HTML tag(s)"] if tags else []
    problems += [f"{len(badmark)} page-marker problem(s)"] if badmark else []
    problems += [f"{len(tables)} malformed table block(s)"] if tables else []
    problems += [f"{len(folios)} trailing folio line(s)"] if folios else []
    problems += [f"{len(stray)} stray folio line(s)"] if stray else []

    if files:
        ok, msg = roots.run_nav(dst.name)
        print("\n--- navigation lines ---\n  " + (msg.splitlines()[-1] if msg else "ok"))
        if not ok:
            problems.append(f"navigation lines: {msg}")

    print("\n=== verdict ===")
    if problems:
        for p in problems:
            print(f"  FAIL: {p}")
        sys.exit(1)
    print("  all checks passed")


if __name__ == "__main__":
    main()
