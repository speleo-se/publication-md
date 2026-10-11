#!/usr/bin/env python3
"""Deterministic, uniform de-hyphenation of the cleaned per-page text.

The LLM cleaning step (per page, often parallelized) is inconsistent about joining
line-break hyphenation — some pages get "ung-\ndom" -> "ungdom", others don't. This
pass runs over ALL cleaned pages afterwards so the result is uniform by construction.

Rules:
  - Within a page, join "<letter>-\\n<lowercase-word>" by dropping the hyphen and
    splicing the two halves, then keep a NEWLINE right after the completed word so the
    rest of that line stays on its own line (line structure is preserved, not merged):
    "på föl-\\njande sätt" -> "på följande\\nsätt". A letter before excludes
    "30-\\ntal" (keeps "30-tal"); a lowercase continuation excludes "Lars-\\nErik"
    (keeps the real compound hyphen).
  - Across a page break, if a page ends with "<letter>-" (optionally then a lone
    page-number line), join the FIRST word of the next page onto it and remove it
    there (e.g. "oriente-" + "rade" -> "orienterade").

Genuine hyphenated compounds (uppercase or digit-adjacent) are left intact.

Usage:
  dehyphenate.py <text-clean-dir>        # e.g. tmp/pdf-cleaner/<name>/text-clean
"""

import glob
import os
import re
import sys

# Capture the char before the hyphen (\1) and the whole continuation word (\2), then
# eat any spaces after it; the replacement re-inserts a newline after the joined word.
_INWORD = re.compile(
    r"([^\W\d_])-\n[ \t]*([a-zàáâäåæçèéêëìíîïñòóôöøùúûü]\S*)[ \t]*"
)
_TAIL = re.compile(r"([^\W\d_])-\s*(?:\n\s*\d+\s*)?$")
_HEAD = re.compile(r"\s*([^\W\d_]+)")


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write(__doc__ or "")
        return 2
    d = sys.argv[1]
    files = sorted(glob.glob(os.path.join(d, "page-*.md")))
    if not files:
        sys.stderr.write(f"dehyphenate: no page-*.md in {d}\n")
        return 1
    # strip soft/discretionary hyphens and zero-width chars (editing/OCR artifacts that
    # otherwise render as stray "-" in the text layer)
    zap = str.maketrans({"­": None, "​": None, "‌": None, "﻿": None})
    pages = [open(f, encoding="utf-8").read().translate(zap) for f in files]

    inword = 0
    for i, s in enumerate(pages):
        pages[i], n = _INWORD.subn(r"\1\2\n", s)  # join the word, keep a newline after it
        inword += n

    cross = 0
    for i in range(len(pages) - 1):
        m = _TAIL.search(pages[i])
        if not m:
            continue
        cm = _HEAD.match(pages[i + 1])
        if not cm:
            continue
        li = m.start(1)                                   # letter before the hyphen
        pages[i] = pages[i][: li + 1] + cm.group(1) + pages[i][li + 2 :]  # drop '-', add cont
        pages[i + 1] = pages[i + 1][cm.end() :].lstrip(" ")
        cross += 1

    for f, s in zip(files, pages):
        open(f, "w", encoding="utf-8").write(s)
    sys.stderr.write(f"dehyphenate: {inword} within-page + {cross} cross-page joins\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
