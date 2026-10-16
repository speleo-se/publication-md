#!/usr/bin/env python3
"""Report which units of the active content repo are transcribed, and which one is next.

An issue is DONE when its page files (the deliverable <name>-content/, the only copy of the
text) hold one pageIndex-NNN.md per page image, none still raw OCR. The critical check is
PLACEHOLDER:
many content folders were pre-seeded with raw unproofread OCR that is byte-identical
to text/page-NN.md. That is NOT processed output and must be redone.

Usage:
    python3 status.py                # summary + the next issue to process
    python3 status.py --list         # every issue with its state
    python3 status.py --list --state PLACEHOLDER
    python3 status.py 1987_2         # resolve one issue (substring match)
"""

import argparse
import json
import sys

from roots import WORK as SRC, CONTENT as DST, NAME, is_unit, read_page, sort_key

# Unit naming and ordering come from the content repo's publication-md.yaml (units.glob /
# units.patterns), via roots.is_unit / roots.sort_key.


def is_raw_copy(f, d):
    """True when a written page is (navigation lines aside) identical to the unproofread OCR."""
    idx = int(f.stem.split("-")[1])
    raw = d / "text" / f"page-{idx + 1:02d}.md"
    return raw.is_file() and read_page(f).rstrip("\n") == raw.read_text(encoding="utf-8").rstrip("\n")


def classify(d):
    """Return (state, detail) for one issue directory."""
    pages = sorted((d / "pages").glob("page-*.png"))
    n = len(pages)
    if n == 0:
        # Nothing rendered. The deliverable may still be populated from an earlier
        # session (or a fresh checkout of the standalone repo, where the render tree
        # is gitignored) — say so, rather than implying no work exists.
        delivered = DST / f"{d.name}-content"
        have = len(list(delivered.glob("pageIndex-*.md"))) if delivered.is_dir() else 0
        extra = f"; deliverable already holds {have} pages" if have else ""
        return "NO_PAGES", f"no page images — render first, see Step 0a{extra}"

    dst = DST / f"{d.name}-content"
    dsts = sorted(dst.glob("pageIndex-*.md")) if dst.is_dir() else []

    # Real (non-raw) work already in the page files — what a crashed session leaves behind,
    # and it must never be reported as "nothing done".
    real = sum(1 for f in dsts if not is_raw_copy(f, d))

    # An unfinished work ledger outranks everything: it says exactly where to resume.
    plan_file = d / ".transcribe" / "plan.json"
    if plan_file.is_file():
        try:
            plan = json.loads(plan_file.read_text())
            groups = plan.get("groups", [])
            done = sum(1 for g in groups if g.get("state") == "done")
            if done < len(groups) or not plan.get("phases", {}).get("sync"):
                return ("IN_PROGRESS",
                        f"{done}/{len(groups)} groups done, {real}/{n} pages transcribed — "
                        f"resume: plan.py {d.name} next")
        except (ValueError, OSError):
            pass

    # Placeholder check: deliverable byte-identical to the raw OCR layer.
    if not dsts:
        return "TODO", f"{n} pages, no page files yet"
    raw_ident = len(dsts) - real
    if raw_ident == len(dsts):
        return "PLACEHOLDER", f"all {len(dsts)} page files are raw OCR — must be redone"
    if raw_ident:
        return "PARTIAL", f"{raw_ident}/{len(dsts)} page files are still raw OCR"
    if len(dsts) != n:
        return "PARTIAL", f"{len(dsts)}/{n} page files ({real} transcribed)"
    return "DONE", f"{n} pages"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("issue", nargs="?", help="substring, e.g. 1987_2")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--state")
    a = ap.parse_args()

    # An issue exists if it has been rendered OR if its source PDF is present.
    # Un-rendered issues must still be listed, or "NEXT" silently means "next among
    # the ones already rendered" — which in a fresh checkout is nothing at all.
    names = set()
    if SRC.is_dir():
        names |= {p.name for p in SRC.iterdir()
                  if p.is_dir() and is_unit(p.name)}
    names |= {p.stem for p in DST.glob("*.pdf") if is_unit(p.stem)}
    if not names:
        sys.exit(f"no units: nothing rendered under {SRC}, no unit PDFs in {DST}")
    dirs = sorted((SRC / n for n in names), key=lambda p: sort_key(p.name))

    if a.issue:
        hits = [d for d in dirs if a.issue in d.name]
        if not hits:
            sys.exit(f"no issue matching {a.issue!r}")
        if len(hits) > 1:
            print(f"{len(hits)} issues match {a.issue!r}:")
        for d in hits:
            state, detail = classify(d)
            print(f"{state:<12} {d.name}  ({detail})")
            print(f"  pages: {DST / (d.name + '-content')}")
            print(f"  render: {d}")
        return

    rows = [(d, *classify(d)) for d in dirs]

    if a.list:
        for d, state, detail in rows:
            if a.state and state != a.state:
                continue
            print(f"{state:<12} {d.name}  ({detail})")
        return

    counts = {}
    for _, state, _ in rows:
        counts[state] = counts.get(state, 0) + 1
    print(f"{NAME} transcription status")
    print(f"  total issues: {len(rows)}")
    for k in sorted(counts):
        print(f"  {k:<12} {counts[k]}")

    todo = [r for r in rows if r[1] != "DONE"]
    if not todo:
        print("\nAll issues are DONE.")
        return
    d, state, detail = todo[0]
    print(f"\nNEXT: {d.name}")
    print(f"  state: {state} ({detail})")
    print(f"  pages: {len(list((d / 'pages').glob('page-*.png')))}")
    print(f"  pages:  {DST / (d.name + '-content')}")
    print(f"  render: {d}")
    if len(todo) > 1:
        print(f"  then:  {todo[1][0].name}")


if __name__ == "__main__":
    main()
