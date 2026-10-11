#!/usr/bin/env python3
"""Join words that are hyphen-broken across a PAGE break, placing the completed word
on the FIRST of the two pages.

The create agents join line-break hyphenation *within* a page, but a word split at
the very bottom of one page and continuing at the top of the next spans two files
and can't be joined per-page. This deterministic pass fixes that: if
`pageIndex-<i>.md` ends with `<letter>-` and `pageIndex-<i+1>.md` starts with a
lowercase continuation word, it appends that continuation to page i (dropping the
hyphen) and removes it from page i+1. So the whole word lives on the first page.

Genuine trailing hyphens are left alone: the continuation must start with a
lowercase letter (skips a new heading/list/number/proper-noun start), and the char
before the hyphen must be a letter (skips "1983-").

Usage:
  join_pagebreaks.py <text-clean-dir>
"""

import glob
import os
import re
import sys

# page i ends with <letter>-  (optionally trailing whitespace)
_TAIL = re.compile(r"([^\W\d_])-\s*$")
# page i+1 starts with a lowercase continuation word (after optional whitespace);
# NOT a markdown heading/list marker, number, or capitalised word.
_HEAD = re.compile(r"^\s*([a-zàáâäåæçèéêëìíîïñòóôöøùúûü][^\s]*)")


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write(__doc__ or "")
        return 2
    d = sys.argv[1]
    files = sorted(glob.glob(os.path.join(d, "pageIndex-*.md")))
    if len(files) < 2:
        print("join_pagebreaks: nothing to do (need >= 2 pages)")
        return 0
    pages = [open(f, encoding="utf-8").read() for f in files]

    joined = 0
    for i in range(len(pages) - 1):
        m = _TAIL.search(pages[i].rstrip("\n"))
        if not m:
            continue
        cm = _HEAD.match(pages[i + 1])
        if not cm:
            continue
        cont = cm.group(1)                       # continuation token, e.g. "forskning,"
        li = m.start(1)                          # index of the letter before the hyphen
        body = pages[i].rstrip()                 # up to and incl. the "<letter>-"
        pages[i] = body[: li + 1] + cont + body[li + 2 :] + "\n"   # drop '-', add cont
        pages[i + 1] = pages[i + 1][cm.end() :].lstrip(" \t")      # remove cont from next page
        joined += 1

    if joined:
        for f, s in zip(files, pages):
            open(f, "w", encoding="utf-8").write(s)
    print(f"join_pagebreaks: {joined} cross-page word(s) joined onto the first page")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
