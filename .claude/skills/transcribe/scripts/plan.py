#!/usr/bin/env python3
"""Durable per-issue work ledger for the transcribe skill.

The ledger lives at <render tree>/<ISSUE>/.transcribe/plan.json (see roots.py) and
session that dies mid-issue (token/usage limit, crash). It records the page
grouping, each group's state, its review score and any notes the next agent needs.

    python3 plan.py 1992_4 survey                 # per-page byte size + opening text
    python3 plan.py 1992_4 init < groups.txt      # define the groups (stdin)
    python3 plan.py 1992_4 next                   # the ONE group to work on now
    python3 plan.py 1992_4 show                   # whole ledger + progress
    python3 plan.py 1992_4 mark 4 created --note "claims: only 1961 underlined"
    python3 plan.py 1992_4 mark 4 reviewed --score 9
    python3 plan.py 1992_4 mark 4 done
    python3 plan.py 1992_4 phase join             # record that --join has been run
    python3 plan.py 1992_4 phase sync             # record the final finalize.py run (name kept
                                                  # for old ledgers; nothing is copied any more)

init stdin format — one group per line, "<pages> <label>", in page order:

    1      omslag
    2-3    ledare
    4-11   medlemsmatrikel
    12,14  notiser

Every page image must be covered exactly once; init refuses an incomplete plan.
"""

import argparse
import json
import sys
from datetime import datetime, timezone

import roots
from roots import WORK as SRC
STATES = ("todo", "created", "reviewed", "done")


def resolve(token):
    roots.require_work()
    hits = [p for p in SRC.iterdir()
            if p.is_dir() and roots.is_unit(p.name) and token in p.name]
    if not hits:
        sys.exit(f"no issue matching {token!r} under {SRC}")
    if len(hits) > 1:
        sys.exit("ambiguous: " + ", ".join(sorted(p.name for p in hits)))
    return hits[0]


def page_files(d, n):
    """(image, raw, output) for 1-based scan number n."""
    return (d / "pages" / f"page-{n:02d}.png",
            d / "text" / f"page-{n:02d}.md",
            roots.pages_dir(d.name) / f"pageIndex-{n - 1:03d}.md")


def page_state(d, n):
    """'none' | 'placeholder' (still raw OCR) | 'clean' for the output of scan n."""
    img, raw, out = page_files(d, n)
    if not out.is_file():
        return "none"
    if raw.is_file() and roots.read_page(out).rstrip("\n") == raw.read_text(encoding="utf-8").rstrip("\n"):
        return "placeholder"
    return "clean"


def span(pages):
    """'4-11' when contiguous, else '12,14'."""
    if len(pages) > 1 and pages[-1] - pages[0] + 1 == len(pages):
        return f"{pages[0]}-{pages[-1]}"
    return ",".join(str(x) for x in pages)


def npages(d):
    return len(list((d / "pages").glob("page-*.png")))


def plan_path(d):
    return d / ".transcribe" / "plan.json"


def load(d):
    p = plan_path(d)
    if not p.is_file():
        sys.exit(f"no plan yet for {d.name} — run:  plan.py {d.name} init < groups.txt")
    return json.loads(p.read_text())


def save(d, plan):
    p = plan_path(d)
    p.parent.mkdir(parents=True, exist_ok=True)
    plan["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    p.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")


def parse_pages(spec):
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def group_line(d, g):
    states = [page_state(d, n) for n in g["pages"]]
    clean = states.count("clean")
    ph = states.count("placeholder")
    extra = f" (+{ph} raw placeholder)" if ph else ""
    score = f" score={g['score']}" if g.get("score") is not None else ""
    return (f"  {g['n']:>2}. {g['state']:<8} pages {span(g['pages']):<9} "
            f"{clean}/{len(g['pages'])} written{extra}{score}  {g['label']}")


def kind_banner(d):
    """Which era this issue belongs to — it decides which rules block applies.

    extract.sh records it in meta.env. 'scanned' (-2006) means text/ is OCR and
    the image is the only truth; 'digital' (2007-) means the PDF has a real text
    layer, so characters, glyphs and emphasis are readable from the bytes and
    only the reading order still needs eyes.
    """
    f = d / "meta.env"
    m = dict(line.split("=", 1) for line in f.read_text().splitlines() if "=" in line) if f.is_file() else {}
    kind = m.get("KIND")
    if kind == "digital":
        return ("KIND=digital (born-digital PDF) — use the BORN-DIGITAL rules block.\n"
                "  text/ is a reading-order hint ONLY: plain pdftotext de-hyphenates, so\n"
                "  compounds and number ranges in it are fused (SSF-medlemmarna -> SSFmedlemmarna,\n"
                "  5-10 -> 510). For character truth, glyphs and emphasis run:\n"
                "    python3 .claude/skills/transcribe/scripts/pagefacts.py <ISSUE> <NN>\n"
                "  A page is often a two-folio SPREAD; one output file still = one PDF page.")
    if kind == "scanned":
        return ("KIND=scanned (OCR'd raster) — use the SCANNED rules block.\n"
                "  text/ is raw OCR, a hint only; the page image is the source of truth.")
    return f"KIND={kind or 'unknown'} — no meta.env; treat as scanned and verify against the image."


def cmd_survey(d, a):
    n = npages(d)
    print(f"{d.name} — {n} page images")
    print(kind_banner(d) + "\n")
    for i in range(1, n + 1):
        img, raw, out = page_files(d, i)
        size = raw.stat().st_size if raw.is_file() else 0
        head = ""
        if raw.is_file():
            head = " ".join(raw.read_text(errors="replace")[:a.chars].split())
        flag = {"none": "", "placeholder": "  [page file is still raw OCR]",
                "clean": "  [page file written]"}[page_state(d, i)]
        print(f"=== page-{i:02d}  ({size} B raw){flag}\n{head}\n")


def cmd_init(d, a):
    n = npages(d)
    if not n:
        sys.exit("no page images")
    p = plan_path(d)
    if p.is_file() and not a.force:
        sys.exit(f"plan already exists: {p}\nUse `next`/`show` to resume, or pass --force to replace it.")

    groups, seen = [], {}
    for raw_line in sys.stdin.read().splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        spec, _, label = line.partition(" ")
        label = label.strip() or "?"
        pages = sorted(parse_pages(spec))
        if not pages:
            sys.exit(f"cannot parse pages from {raw_line!r}")
        for x in pages:
            if x in seen:
                sys.exit(f"page {x} is in two groups ({seen[x]!r} and {label!r})")
            if not 1 <= x <= n:
                sys.exit(f"page {x} out of range 1..{n}")
            seen[x] = label
        groups.append({"n": len(groups) + 1, "label": label, "pages": pages,
                       "state": "todo", "score": None, "notes": []})

    missing = [x for x in range(1, n + 1) if x not in seen]
    if missing:
        shown = ", ".join(str(x) for x in missing[:20]) + (" ..." if len(missing) > 20 else "")
        sys.exit(f"plan does not cover every page — {len(missing)} missing: {shown}")

    save(d, {"issue": d.name, "pages": n, "groups": groups,
             "phases": {"join": False, "sync": False},
             "created": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    print(f"plan written: {p}\n{len(groups)} groups over {n} pages")
    for g in groups:
        print(group_line(d, g))


def cmd_show(d, a):
    plan = load(d)
    done = sum(1 for g in plan["groups"] if g["state"] == "done")
    print(f"{plan['issue']} — {plan['pages']} pages, {done}/{len(plan['groups'])} groups done"
          f"   [join={plan['phases']['join']} sync={plan['phases']['sync']}]")
    for g in plan["groups"]:
        print(group_line(d, g))
        for note in g["notes"]:
            print(f"        · {note}")


def cmd_next(d, a):
    plan = load(d)
    todo = [g for g in plan["groups"] if g["state"] != "done"]
    if not todo:
        print(f"ALL GROUPS DONE ({len(plan['groups'])} groups, {plan['pages']} pages)")
        print(f"phases: join={plan['phases']['join']} sync={plan['phases']['sync']}")
        if not plan["phases"]["join"]:
            print("NEXT ACTION: finalize.py --join  (step 3)")
        elif not plan["phases"]["sync"]:
            print("NEXT ACTION: finalize.py  (step 4), then plan.py … phase sync")
        else:
            print("NEXT ACTION: report and stop")
        return
    g = todo[0]
    action = {"todo": "dispatch ONE create agent for this group",
              "created": "dispatch ONE review agent for this group",
              "reviewed": "score <= 8: fix and re-review; score >= 9: mark done"}[g["state"]]
    print(f"{plan['issue']}  group {g['n']}/{len(plan['groups'])}  "
          f"({sum(1 for x in plan['groups'] if x['state'] == 'done')} done)")
    print(kind_banner(d))
    print(f"label: {g['label']}")
    print(f"state: {g['state']}" + (f"  score={g['score']}" if g.get("score") is not None else ""))
    print(f"NEXT ACTION: {action}")
    for note in g["notes"]:
        print(f"note: {note}")
    print("pages (image = source of truth, raw = hint only, output = what you write):")
    for i in g["pages"]:
        img, raw, out = page_files(d, i)
        flag = {"none": "",
                "placeholder": "   [RAW OCR PLACEHOLDER — must be rewritten]",
                "clean": "   [ALREADY TRANSCRIBED — keep unless redoing]"}[page_state(d, i)]
        print(f"  {img}\n    raw: {raw}\n    out: {out}{flag}")


def cmd_mark(d, a):
    plan = load(d)
    hits = [g for g in plan["groups"] if str(g["n"]) == a.group or g["label"] == a.group]
    if len(hits) != 1:
        sys.exit(f"no single group matching {a.group!r}")
    g = hits[0]
    g["state"] = a.state
    if a.score is not None:
        g["score"] = a.score
    if a.note:
        g["notes"].append(a.note)
    if a.state == "todo":
        g["score"] = None
    save(d, plan)
    print(group_line(d, g))
    for note in g["notes"]:
        print(f"        · {note}")


def cmd_phase(d, a):
    plan = load(d)
    plan["phases"][a.name] = not a.undo
    save(d, plan)
    print(f"phases: {plan['phases']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("issue", help="substring, e.g. 1992_4")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("survey", help="per-page raw size + opening text, to plan groups")
    s.add_argument("--chars", type=int, default=300)
    s.set_defaults(fn=cmd_survey)

    s = sub.add_parser("init", help="define groups from stdin")
    s.add_argument("--force", action="store_true", help="replace an existing plan")
    s.set_defaults(fn=cmd_init)

    sub.add_parser("show", help="whole ledger").set_defaults(fn=cmd_show)
    sub.add_parser("next", help="the one group to work on now").set_defaults(fn=cmd_next)

    s = sub.add_parser("mark", help="set a group's state")
    s.add_argument("group", help="group number or label")
    s.add_argument("state", choices=STATES)
    s.add_argument("--score", type=int)
    s.add_argument("--note")
    s.set_defaults(fn=cmd_mark)

    s = sub.add_parser("phase", help="record an issue-level phase")
    s.add_argument("name", choices=("join", "sync"))
    s.add_argument("--undo", action="store_true")
    s.set_defaults(fn=cmd_phase)

    a = ap.parse_args()
    a.fn(resolve(a.issue), a)


if __name__ == "__main__":
    main()
