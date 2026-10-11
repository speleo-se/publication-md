#!/usr/bin/env python3
"""Collapse legacy in-line double spaces in the active content corpus.

Issues finished before 2014-4 kept measured "typed" double spaces. Markdown
renders them as one space, so in prose they are noise; in field rows
(addresses, registers, mastheads, bibliographies) they were the only field
separator and become " · " instead.

    python3 collapse_spaces.py            # dry run: counts + samples + review list
    python3 collapse_spaces.py --apply    # rewrite the files
    python3 collapse_spaces.py --notes    # list notes that discuss spacing

Never touched: trailing hard-break spaces, leading indentation, fenced code,
HTML comments, empty table cells.
"""

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roots import CONTENT, TRANSCRIBE  # noqa: E402

# The content's label for transcription notes (publication-md.yaml transcribe.noteLabel).
NOTE_LABEL = TRANSCRIBE.get("noteLabel", "Transcription note")

RUN = re.compile(r"(?<=\S) {2,}(?=\S)")
LIST = re.compile(r"^(\s*(?:[-*+]|\d+\.)\s+)")
SPACE_NOTE = re.compile(r"(blanksteg|mellanslag|mellanrum)", re.I)
SEP = " · "


def is_field_row(body: str, runs: int) -> bool:
    """Run-separated segments that are short and not sentences."""
    if body.lstrip().startswith(("#", "*[", ">")):
        return False
    segs = [s for s in RUN.split(LIST.sub("", body)) if s.strip()]
    if len(segs) < 2:
        return False
    words = [len(s.split()) for s in segs]
    is_list = bool(LIST.match(body))
    # A list item with run separators is a register/bibliography row.
    if is_list:
        return True
    # Scale bars ("10  20 m") and number pairs are not fields.
    if all(re.fullmatch(r"[\d,.\s]+(m|km)?", x.strip()) for x in segs):
        return False
    if max(words) > 8:
        return False
    # A short segment ending a sentence followed by a capital is prose.
    if any(re.search(r"[.!?]$", s) and len(s.split()) > 3 for s in segs[:-1]):
        return False
    return runs >= 2 or len(body) <= 60


def fix_line(line: str, stats: Counter, review: list, where: str) -> str:
    nl = "\n" if line.endswith("\n") else ""
    s = line[: len(line) - len(nl)]
    stripped = s.rstrip(" ")
    trail = s[len(stripped):]
    indent = stripped[: len(stripped) - len(stripped.lstrip(" "))]
    body = stripped[len(indent):]
    runs = len(RUN.findall(body))
    if not runs:
        return line
    if body.startswith("|"):
        cells = body.split("|")
        new = "|".join(RUN.sub(" ", c) for c in cells)
        stats["table"] += sum(len(RUN.findall(c)) for c in cells)
    elif NOTE_LABEL in body:
        new = RUN.sub(" ", body)
        stats["note"] += runs
    elif is_field_row(body, runs):
        m = LIST.match(body)
        head = m.group(1) if m else ""
        new = head + RUN.sub(SEP, body[len(head):])
        stats["field"] += runs
        if runs == 1 and not m:
            review.append(f"{where}: {new}")
    else:
        new = RUN.sub(" ", body)
        stats["prose"] += runs
    return indent + new + trail + nl


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--notes", action="store_true")
    ap.add_argument("--samples", type=int, default=0)
    a = ap.parse_args()
    stats, review, samples, notes, changed = Counter(), [], [], [], 0
    for f in sorted(CONTENT.glob("*-content/**/*.md")):
        rel = f.relative_to(CONTENT)
        lines = f.read_text(encoding="utf-8").splitlines(keepends=True)
        out, fenced = [], False
        for i, ln in enumerate(lines, 1):
            t = ln.strip()
            if t.startswith("```"):
                fenced = not fenced
            if fenced or t.startswith("```") or t.startswith("<!--"):
                out.append(ln)
                continue
            if NOTE_LABEL in ln and SPACE_NOTE.search(ln):
                notes.append(f"{rel}:{i}")
            new = fix_line(ln, stats, review, f"{rel}:{i}")
            if new != ln and len(samples) < 100000:
                samples.append(f"{rel}:{i}\n  - {ln.rstrip()[:160]}\n  + {new.rstrip()[:160]}")
            out.append(new)
        if out != lines:
            changed += 1
            if a.apply:
                f.write_text("".join(out), encoding="utf-8")
    print(f"{'applied' if a.apply else 'dry run'}: {changed} files, runs per class {dict(stats)}")
    print(f"single-run field rows to spot-check: {len(review)}")
    if a.samples:
        import random

        random.seed(1)
        print("\n".join(random.sample(samples, min(a.samples, len(samples)))))
        print("--- review sample")
        print("\n".join(random.sample(review, min(a.samples, len(review)))))
    if a.notes:
        print("\n".join(notes))
    print(f"notes mentioning spacing: {len(notes)}")


if __name__ == "__main__":
    main()
