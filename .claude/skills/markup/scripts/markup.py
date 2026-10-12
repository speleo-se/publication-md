#!/usr/bin/env python3
"""Which units of the active content repo are marked up (publication-md metadata), and which is next.

A unit is MARKED when its deliverable folder has a publication.md (the markup skill writes it
last, after the page files validate). Order and naming come from the content repo's config.

    python3 markup.py            # summary + NEXT
    python3 markup.py --list     # every unit with its state
    python3 markup.py 1987_2     # one unit: paths, page count, PDF/page images present?
    python3 markup.py 1987_3 --block "reason"   # mark a unit BLOCKED (Next skips it); --unblock
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "transcribe" / "scripts"))
from roots import CONTENT, WORK, NAME, is_unit, sort_key  # noqa: E402


def units():
    names = {p.name[: -len("-content")] for p in CONTENT.iterdir()
             if p.is_dir() and p.name.endswith("-content") and is_unit(p.name[: -len("-content")])}
    return sorted(names, key=sort_key)


def state(u):
    dst = CONTENT / f"{u}-content"
    if (dst / "publication.md").is_file():
        return "MARKED"
    if (WORK / u / ".markup-blocked").is_file():
        return "BLOCKED"
    if not (WORK / u / "text-clean").is_dir():
        return "NO_WORK"  # no render tree / work copy: render first (pdf-extract), see SKILL.md
    if not list((WORK / u / "pages").glob("page-*.png")):
        return "NO_PAGES"
    return "TODO"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("unit", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--block", metavar="REASON")
    ap.add_argument("--unblock", action="store_true")
    a = ap.parse_args()
    us = units()
    if a.unit:
        hits = [u for u in us if a.unit in u]
        if len(hits) != 1:
            sys.exit(f"{len(hits)} units match {a.unit!r}: {', '.join(hits[:8])}")
        u = hits[0]
        marker = WORK / u / ".markup-blocked"
        if a.block:
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(a.block + "\n", encoding="utf-8")
            print(f"BLOCKED   {u}: {a.block}")
            return
        if a.unblock:
            marker.unlink(missing_ok=True)
            print(f"unblocked {u}")
            return
        pages = sorted((WORK / u / "pages").glob("page-*.png"))
        print(f"{state(u):<9} {u}")
        if marker.is_file():
            print(f"  blocked:    {marker.read_text(encoding='utf-8').strip()}")
        print(f"  work copy:  {WORK / u / 'text-clean'}")
        print(f"  pages:      {WORK / u / 'pages'} ({len(pages)} images)")
        print(f"  pdf:        {WORK / u / 'original.pdf'} ({'present' if (WORK / u / 'original.pdf').is_file() else 'MISSING'})")
        print(f"  deliverable:{CONTENT / (u + '-content')}")
        return
    rows = [(u, state(u)) for u in us]
    if a.list:
        for u, s in rows:
            print(f"{s:<9} {u}")
        return
    counts = {}
    for _, s in rows:
        counts[s] = counts.get(s, 0) + 1
    print(f"{NAME} markup status")
    for k in sorted(counts):
        print(f"  {k:<9} {counts[k]}")
    for u, s in rows:
        if s == "BLOCKED":
            print(f"  blocked: {u} — {(WORK / u / '.markup-blocked').read_text(encoding='utf-8').strip()}")
    todo = [u for u, s in rows if s not in ("MARKED", "BLOCKED")]
    if todo:
        print(f"\nNEXT: {todo[0]}  ({state(todo[0])})")
    else:
        print("\nAll units are MARKED.")


if __name__ == "__main__":
    main()
