#!/usr/bin/env python3
"""One-off migration: retire the work copies (work/<name>/<unit>/text-clean/).

The page text now lives only in the deliverable (<content>/<unit>-content/). For every unit
that still has a text-clean/ folder:

  - deliverable has the same pages (navigation lines and final newline aside) -> the work copy
    is redundant: moved to work/<name>/<unit>/.text-clean.bak/ (delete by hand later);
  - deliverable missing or without page files -> the pages are MOVED into a new deliverable
    folder (and get their navigation lines);
  - anything else (pages differ, page sets differ) -> reported, left alone. Decide by hand.

    python3 retire_text_clean.py            # dry run: what would happen
    python3 retire_text_clean.py --apply
"""

import argparse
import shutil
import sys

import roots
from roots import WORK, is_unit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    roots.require_work()

    redundant, adopt, conflict = [], [], []
    for d in sorted(p for p in WORK.iterdir() if p.is_dir() and is_unit(p.name)):
        clean = d / "text-clean"
        if not clean.is_dir():
            continue
        cleans = sorted(clean.glob("pageIndex-*.md"))
        dst = roots.pages_dir(d.name)
        dsts = sorted(dst.glob("pageIndex-*.md")) if dst.is_dir() else []
        if not cleans:
            redundant.append((d, "empty"))
        elif not dsts:
            adopt.append(d)
        elif {f.name for f in cleans} != {f.name for f in dsts}:
            conflict.append((d, f"page sets differ ({len(cleans)} work vs {len(dsts)} deliverable)"))
        else:
            differ = [f.name for f in cleans if not roots.same_page(f, dst / f.name)]
            if differ:
                conflict.append((d, f"{len(differ)} page(s) differ: {', '.join(differ[:5])}"))
            else:
                redundant.append((d, f"{len(cleans)} pages identical"))

    print(f"redundant work copies: {len(redundant)}")
    print(f"units only in work (move into the content repo): {len(adopt)}")
    for d in adopt:
        print(f"  ADOPT    {d.name}")
    print(f"conflicts (left alone): {len(conflict)}")
    for d, why in conflict:
        print(f"  CONFLICT {d.name}: {why}")

    if not a.apply:
        print("\ndry run — re-run with --apply")
        return
    for d, _ in redundant:
        bak = d / ".text-clean.bak"
        if bak.exists():
            shutil.rmtree(bak)
        (d / "text-clean").rename(bak)
    for d in adopt:
        dst = roots.pages_dir(d.name)
        dst.mkdir(parents=True, exist_ok=True)
        for f in sorted((d / "text-clean").glob("pageIndex-*.md")):
            shutil.move(str(f), dst / f.name)
        (d / "text-clean").rmdir()
        ok, msg = roots.run_nav(dst.name)
        if not ok:
            print(f"  ! nav {dst.name}: {msg}")
    print(f"\napplied: {len(redundant)} retired to .text-clean.bak/, {len(adopt)} adopted"
          + (f"; {len(conflict)} conflict(s) still need a decision" if conflict else ""))
    sys.exit(1 if conflict else 0)


if __name__ == "__main__":
    main()
