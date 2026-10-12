#!/usr/bin/env python3
"""Write a percent-grid preview of a page image, for reading figure regions off by eye.

    python3 grid.py <page-NN.png> <out.png> [--width 700]

Red lines every 10 %, pink every 5 %, labels in blue. Read regions off it, then ALWAYS run
refine_regions.py — hand-read edges are routinely a little tight.
"""
import argparse
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--width", type=int, default=700)
a = ap.parse_args()
im = Image.open(a.src).convert("RGB")
im = im.resize((a.width, round(im.height * a.width / im.width)))
d = ImageDraw.Draw(im)
w, h = im.size
for p in range(0, 101, 5):
    c = (255, 0, 0) if p % 10 == 0 else (255, 170, 170)
    x, y = round(w * p / 100), round(h * p / 100)
    d.line([(x, 0), (x, h)], fill=c)
    d.line([(0, y), (w, y)], fill=c)
    if p % 10 == 0:
        d.text((x + 2, 2), str(p), fill=(0, 0, 255))
        d.text((2, y + 2), str(p), fill=(0, 0, 255))
im.save(a.out)
print(f"{a.out} {im.size}")
