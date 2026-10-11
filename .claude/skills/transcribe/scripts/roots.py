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


_PATTERNS = [_py_regex(p) for p in _UNITS.get("patterns", [])]


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
