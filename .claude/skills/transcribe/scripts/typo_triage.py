#!/usr/bin/env python3
"""Flag likely typos in the DONE transcriptions of the active content, using the corpus as its own dictionary.

No spellchecker or wordlist is available offline, so we exploit a property of typos:
a typo is a RARE token that is one edit away from a MUCH more common token. Real words
and proper nouns may be rare, but they are seldom near-neighbours of a frequent word.

Also flags dittography (a word set twice in a row), which is always an error.

Usage:
    python3 typo_triage.py                 # corpus-wide report
    python3 typo_triage.py --issue <name>  # one issue
    python3 typo_triage.py --min-ratio 20  # stricter (default 15)
"""

import argparse
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from roots import WORK as SRC, TRANSCRIBE

STATUS = Path(__file__).with_name("status.py")

# Extra letters of the content language for edit candidates (publication-md.yaml
# transcribe.alphabet), plus common Latin-1 accents.
LETTERS = "".join(dict.fromkeys(str(TRANSCRIBE.get("alphabet", "")).lower() + "éèüáíóú"))

# Words are letter-runs in any alphabet. Digits split tokens apart.
WORD = re.compile(r"[^\W\d_]+")

# Lines we must not treat as prose: our own editorial notes.
NOTE = re.compile(r"^\s*\*?\[")


def done_issues():
    out = subprocess.run(
        [sys.executable, STATUS, "--list", "--state", "DONE"],
        capture_output=True, text=True, check=True).stdout
    return [ln.split()[1] for ln in out.splitlines() if ln.startswith("DONE")]


def pages(issue):
    return sorted((SRC / issue / "text-clean").glob("pageIndex-*.md"))


def tokens(path, skip_notes=True):
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if skip_notes and NOTE.match(line):
            continue
        for m in WORD.finditer(line):
            yield lineno, m.group(0), line, m.start(), m.end()


# English blocks are where the retired "VERBATIM ENGLISH" rule did its damage.
EN_HEAD = re.compile(r"\b(SUMMAR|ABSTRACT)", re.I)
EN_STOP = {"the", "of", "and", "is", "are", "in", "to", "was", "were", "with",
           "has", "have", "been", "that", "this", "from", "which", "there",
           "it", "its", "by", "for", "at", "on", "as", "be", "not", "an"}


def english_blocks(path):
    """Yield (lineno, line) for lines that are clearly English prose."""
    text = path.read_text(encoding="utf-8")
    flagged_page = bool(EN_HEAD.search(text))
    for lineno, line in enumerate(text.splitlines(), 1):
        if NOTE.match(line) or not line.strip():
            continue
        words = [w.lower() for w in WORD.findall(line)]
        if len(words) < 6:
            continue
        ratio = sum(w in EN_STOP for w in words) / len(words)
        if ratio >= 0.18 or (flagged_page and ratio >= 0.12):
            yield lineno, line


def edits1(w):
    """All strings one edit from w, restricted to the alphabet actually in the corpus."""
    letters = "abcdefghijklmnopqrstuvwxyz" + LETTERS
    splits = [(w[:i], w[i:]) for i in range(len(w) + 1)]
    out = set()
    for L, R in splits:
        if R:
            out.add(L + R[1:])                        # delete
            for c in letters:
                out.add(L + c + R[1:])                # substitute
        if len(R) > 1:
            out.add(L + R[1] + R[0] + R[2:])          # transpose
        for c in letters:
            out.add(L + c + R)                        # insert
    out.discard(w)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--issue")
    ap.add_argument("--min-ratio", type=int, default=15,
                    help="how many times more common the neighbour must be")
    ap.add_argument("--max-freq", type=int, default=1,
                    help="a candidate typo must occur at most this often corpus-wide")
    ap.add_argument("--english", action="store_true",
                    help="instead of typo flags, list the English/abstract blocks")
    args = ap.parse_args()

    issues = done_issues()

    # ---- English-block locator (no frequency pass needed) -------------------
    if args.english:
        targets = [args.issue] if args.issue else issues
        npages = 0
        for iss in targets:
            found = [(p, list(english_blocks(p))) for p in pages(iss)]
            found = [(p, b) for p, b in found if b]
            if not found:
                continue
            print(f"\n=== {iss} ===")
            for p, blocks in found:
                print(f"  {p.name}  ({len(blocks)} english lines)")
                npages += 1
        print(f"\n{npages} pages with English blocks across {len(targets)} issue(s)")
        return

    # ---- pass 1: corpus-wide frequency (lowercased) -------------------------
    freq = Counter()
    for iss in issues:
        for p in pages(iss):
            for _, w, _, _, _ in tokens(p):
                freq[w.lower()] += 1

    # ---- pass 2: flag candidates -------------------------------------------
    targets = [args.issue] if args.issue else issues
    hits = defaultdict(list)
    ditto_hits = defaultdict(list)

    for iss in targets:
        for p in pages(iss):
            prev = None  # (lowered word, lineno, end offset)
            for lineno, w, line, start, end in tokens(p):
                lw = w.lower()
                # Real dittography = same word twice with ONLY whitespace between.
                # "Nej, nej" and "okänd, okänd" are legitimate repetition, not errors.
                if (prev and prev[0] == lw and len(lw) > 2 and prev[1] == lineno
                        and line[prev[2]:start].strip() == ""):
                    ditto_hits[iss].append((p.name, lineno, w, line.strip()[:110]))
                prev = (lw, lineno, end)

                # Capitalised mid-sentence tokens are usually proper nouns, where the
                # correct form is rarely certain — skip unless the whole page is English.
                if w[:1].isupper() and start > 0:
                    continue
                if len(lw) < 4 or freq[lw] > args.max_freq:
                    continue
                best, bestf = None, 0
                for cand in edits1(lw):
                    f = freq.get(cand, 0)
                    if f > bestf:
                        best, bestf = cand, f
                if best and bestf >= args.min_ratio * max(freq[lw], 1):
                    hits[iss].append((p.name, lineno, w, best, bestf, line.strip()[:110]))

    total = 0
    for iss in targets:
        rows, dit = hits.get(iss, []), ditto_hits.get(iss, [])
        if not rows and not dit:
            continue
        print(f"\n=== {iss} ===")
        for name, lineno, w, best, bf, ctx in rows:
            print(f"  {name}:{lineno}  {w!r} -> {best!r} (x{bf})   {ctx}")
        for name, lineno, w, ctx in dit:
            print(f"  {name}:{lineno}  DITTO {w!r}   {ctx}")
        total += len(rows) + len(dit)

    print(f"\ncorpus vocabulary: {len(freq)} distinct words over {len(issues)} DONE issues")
    print(f"flagged: {total} candidates in {len(targets)} issue(s)")


if __name__ == "__main__":
    main()
