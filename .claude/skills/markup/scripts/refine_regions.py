#!/usr/bin/env python3
"""Refine the img/pNNN_pct-x,y,w,h.jpg regions in a unit's work copy against the page scans.

    python3 refine_regions.py <UNIT> [--apply]      # dry run lists changes; --apply rewrites the files

Per edge, on the FULL-resolution page image (downscaling blurs 1-px frame lines):
  1. an edge that cuts through ink is pushed outward to the nearest white gutter (≤ 4 % of the
     page), so a photo or map is never cut; an edge already in white only takes a thin line just
     outside it (≤ 0.4 %: a frame or rule), never a caption or text line;
  2. then pad up to 0.8 % — but only into white, never onto the next ink (text, rules).
A thin white margin beats any cut. When no gutter is found within 4 %, the edge is kept and the
region is FLAGGED: look at it (crop-box overlay on the page) and set it by hand.
Whole-page regions (0,0,100,100) are left alone.
"""
import argparse
import re
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "transcribe" / "scripts"))
from roots import WORK  # noqa: E402

SEARCH, PAD, INK, WHITE, THIN = 0.04, 0.008, 140, 0.004, 0.004
RE = re.compile(r"img/p(\d{3})_pct-([\d.]+),([\d.]+),([\d.]+),([\d.]+)\.jpg")


def ink(im, box):
    x0, y0, x1, y1 = (int(v) for v in box)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(im.width, x1), min(im.height, y1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    strip = im.crop((x0, y0, x1, y1)).point(lambda v: 255 if v < INK else 0)
    return strip.histogram()[255] / ((x1 - x0) * (y1 - y0))


def refine(im, x, y, w, h):
    W, H = im.size
    L, T, R, B = x / 100 * W, y / 100 * H, (x + w) / 100 * W, (y + h) / 100 * H
    flags = []

    def strip(edge, n, width=2):
        return {"L": (L - n - width, T, L - n, B), "R": (R + n, T, R + n + width, B),
                "T": (L, T - n - width, R, T - n), "B": (L, B + n, R, B + n + width)}[edge]

    def edge_row(edge):  # the region's own outermost 2 px on that side
        return {"L": (L, T, L + 2, B), "R": (R - 2, T, R, B), "T": (L, T, R, T + 2), "B": (L, B - 2, R, B)}[edge]

    out = {}
    for edge in "LRTB":
        size = W if edge in "LR" else H
        lim = round(SEARCH * size)
        if ink(im, edge_row(edge)) >= WHITE:
            # The edge cuts through ink: push out to the nearest white gutter.
            step = next((n for n in range(lim) if ink(im, strip(edge, n)) < WHITE), None)
            if step is None:
                flags.append(edge)
                step = 0
        else:
            # The edge is in white. Take a THIN ink run just outside (a frame line, a rule — part of
            # the figure or harmless) but never a thicker one (a caption or text line).
            run = 0
            while run < lim and ink(im, strip(edge, run, 1)) >= WHITE:
                run += 1
            step = run if 0 < run <= THIN * size else 0
        out[edge] = step
    L, R, T, B = L - out["L"], R + out["R"], T - out["T"], B + out["B"]
    def inner(edge, n):  # 1-px strip n px INSIDE the edge
        return {"L": (L + n, T, L + n + 1, B), "R": (R - n - 1, T, R - n, B),
                "T": (L, T + n, R, T + n + 1), "B": (L, B - n - 1, R, B - n)}[edge]

    for edge in "LRTB":
        lim = round(PAD * (W if edge in "LR" else H))
        # White already inside the edge counts towards the margin, so re-running is a no-op.
        have = 0
        while have < lim and ink(im, inner(edge, have)) < WHITE:
            have += 1
        n = 0
        while n < lim - have and ink(im, strip(edge, n, 1)) < WHITE:
            n += 1
        if edge == "L": L -= n
        if edge == "R": R += n
        if edge == "T": T -= n
        if edge == "B": B += n
    L, T, R, B = max(0, L), max(0, T), min(W, R), min(H, B)
    r = [round(L / W * 100, 2), round(T / H * 100, 2), round((R - L) / W * 100, 2), round((B - T) / H * 100, 2)]
    r[2] = min(r[2], round(100 - r[0], 2))
    r[3] = min(r[3], round(100 - r[1], 2))
    return r, flags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("unit")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    hits = [p for p in WORK.iterdir() if p.is_dir() and a.unit in p.name]
    if len(hits) != 1:
        sys.exit(f"{len(hits)} units match {a.unit!r}")
    d = hits[0]
    flagged = 0
    for f in sorted((d / "text-clean").glob("pageIndex-*.md")):
        t = f.read_text(encoding="utf-8")
        new = t
        for m in RE.finditer(t):
            idx, reg = int(m.group(1)), [float(v) for v in m.groups()[1:]]
            if reg == [0, 0, 100, 100]:
                continue
            im = Image.open(d / "pages" / f"page-{idx + 1:02d}.png").convert("L")
            r, flags = refine(im, *reg)
            path = f"img/p{idx:03d}_pct-" + ",".join(f"{v:g}" for v in r) + ".jpg"
            mark = f"  FLAGGED (no white gutter on {''.join(flags)}: check by eye)" if flags else ""
            flagged += bool(flags)
            print(f"{f.name}: {m.group(0)} -> {path}{mark}")
            new = new.replace(m.group(0), path)
        if a.apply and new != t:
            f.write_text(new, encoding="utf-8")
    print(f"{'applied' if a.apply else 'dry run'}; {flagged} flagged")


if __name__ == "__main__":
    main()
