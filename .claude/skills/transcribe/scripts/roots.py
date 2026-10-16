"""Resolve the active content repo, its render tree and its config for the skill scripts.

publication-md is a workspace: content repos sit (cloned or symlinked) under content/<name>,
their render trees under work/<name>, and one of them is active (see the repo README).
The single source of truth for that resolution is tools/workspace.ts — this module just
asks it, so the Python scripts and the TypeScript tools can never disagree.

    CONTENT  the content repo root (unit folders <unit>-content/, PDFs beside them)
    WORK     the render tree (<unit>/pages, text, text-clean, .transcribe/plan.json)
    CONFIG   the content repo's publication-md.yaml, parsed

Pick another repo for one run with PMD_CONTENT=<name>; pin paths explicitly with
PMD_CONTENT_ROOT / PMD_WORK_ROOT (legacy GROTTAN_CONTENT_ROOT / GROTTAN_WORK_ROOT).
"""

import json
import re
import subprocess
import sys
from pathlib import Path

# <root>/.claude/skills/transcribe/scripts/roots.py — never hardcode absolute paths.
ROOT = Path(__file__).resolve().parents[4]
_WORKSPACE = ROOT / "tools" / "workspace.ts"

_r = subprocess.run(["node", str(_WORKSPACE), "--json"], capture_output=True, text=True)
if _r.returncode:
    sys.exit(_r.stderr.strip() or f"could not resolve the workspace ({_WORKSPACE})")
_ws = json.loads(_r.stdout)

NAME = _ws["name"]
CONTENT = Path(_ws["contentRoot"])
WORK = Path(_ws["workRoot"])
CONFIG = _ws["config"]
TRANSCRIBE = CONFIG.get("transcribe") or {}
RULES = CONTENT / CONFIG.get("rules", "rules")

RENDER_HINT = f"PDF_EXTRACT_OUT={WORK} bash .claude/skills/pdf-extract/scripts/extract.sh {CONTENT}/<UNIT>.pdf"

_UNITS = CONFIG["units"]
_GLOB = re.compile("^" + re.escape(_UNITS["glob"]).replace(r"\*", ".*").replace(r"\?", ".") + "$")


def _py_regex(p):
    # Config patterns use JS named groups (?<name>…); Python wants (?P<name>…).
    return re.compile(re.sub(r"\(\?<(?![=!])", "(?P<", p))


# A pattern is a regex string or {pattern, id}.
_PATTERNS = [_py_regex(p["pattern"] if isinstance(p, dict) else p) for p in _UNITS.get("patterns", [])]


def is_unit(name):
    """True for a unit name (without -content) matching the content's units.glob."""
    return bool(_GLOB.match(name))


def unit_info(name):
    """Named groups (year / issue / volume) of the first matching units.patterns entry."""
    for p in _PATTERNS:
        m = p.match(name)
        if m:
            return m.groupdict()
    return {}


def sort_key(name):
    """(year, first issue number, name) — same order as the TS compareUnits()."""
    g = unit_info(name)
    year = int(g["year"]) if g.get("year") else 9999
    issue = int(g["issue"].split("-")[0]) if g.get("issue") else 99
    return (year, issue, name)


def require_work():
    """Exit with an actionable message when nothing has been rendered yet."""
    if not WORK.is_dir():
        sys.exit(f"no render tree at {WORK}\nRender a unit first, from the publication-md root:\n  {RENDER_HINT}")
    return WORK


# Navigation lines (spec §3.6, `npm run nav`): generated prev/next links that only the
# deliverable carries. Mirror of lib/src/nav.ts stripNav — compare work copy and deliverable
# with them removed.
_NAV = re.compile(r"^\[.*\) <!-- nav: generated -->$")


def strip_nav(text):
    if "<!-- nav: generated -->" not in text:
        return text
    lines = text.split("\n")
    while lines and _NAV.match(lines[0]):
        lines.pop(0)
        if lines and lines[0] == "":
            lines.pop(0)
    trailing = lines and lines[-1] == ""
    if trailing:
        lines.pop()
    while lines and _NAV.match(lines[-1]):
        lines.pop()
        if lines and lines[-1] == "":
            lines.pop()
    body = [ln for ln in lines if not _NAV.match(ln)]
    if trailing:
        body.append("")
    return "\n".join(body)


def same_page(work_file, deliverable_file):
    """True when the deliverable page equals the work copy, navigation lines (and the final
    newline they bring) aside."""
    try:
        a = Path(work_file).read_text(encoding="utf-8")
        b = Path(deliverable_file).read_text(encoding="utf-8")
    except OSError:
        return False
    return a.rstrip("\n") == strip_nav(b).rstrip("\n")


def run_nav(unit_folder):
    """Write the navigation lines of one deliverable folder (`npm run nav -- <folder>`)."""
    r = subprocess.run(["node", str(ROOT / "tools" / "nav.ts"), unit_folder],
                       capture_output=True, text=True, cwd=ROOT)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def pages_dir(unit):
    """The ONE place a unit's page text lives: the deliverable <CONTENT>/<unit>-content/.
    (There is no separate work copy any more; work/<unit>/ holds the render, raw text and ledger.)"""
    return CONTENT / f"{unit}-content"


_CORRECTION = re.compile(r" ?\([^()|\n]*\)<!-- toc: correction -->")


def read_page(path):
    """A page file's text as printed: without generated navigation lines and TOC corrections
    (mirror of lib/src/nav.ts stripGenerated)."""
    return _CORRECTION.sub("", strip_nav(Path(path).read_text(encoding="utf-8")))
