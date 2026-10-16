# Roadmap — possible future work

Ideas that would make publication-md more useful. Nothing here is committed to or scheduled.
Changes to the format go through the 0.x versioning (spec §7) and `npm run content -- upgrade`.

## Rotate images

Some pictures are printed sideways. Today an extracted image keeps the page's orientation.

- **Possible approach:** an optional rotation in the image region path, e.g.
  `img/p012_pct-8,31.5,84,43.25_r90.jpg`, or `rotate: 90 | 180 | 270` on the `figure` block.
- **Affects:** `lib/src/imagePath.ts` (parse/format), `tools/extract-images.ts` (crop, then rotate),
  validate.

## Merge pictures over two pages

A photo or map printed across a spread can be split over two PDF pages (scanned issues).

- **Possible approach:** one `figure` with two regions, one per pageIndex, which `extract-images`
  stitches into one image. The figure key already allows a range (`16-17|f1`).
- **Affects:** the image path syntax or the figure block, `tools/extract-images.ts`,
  `refine_regions.py` (one region per page).

## Released versions per unit

An importer (e.g. Speleotastic) re-imports the whole corpus today. With a released version per
unit, only the units that changed need to be imported again.

- **Possible approach:** each unit carries a release (`version` / `released` in `publication.md`,
  or a git tag per unit), bumped when its content changes. The importer records the version it
  imported and skips units whose version is unchanged.
- **Needs:**
  - a content hash or changelog per unit;
  - a tool that bumps the changed units (`npm run release`, or the pre-commit hook);
  - validate checks.

## Tools to verify images

Crops are checked by eye today, and `refine_regions.py` flags regions without a white gutter.

- **Possible approach:**
  - a review page per unit: every crop next to its page with the region drawn, and the flags;
  - checks for missing, empty or tiny crops and for crops that cut through content;
  - a review status per figure.
- **Builds on:** `tools/extract-images.ts`, `.claude/skills/markup/scripts/refine_regions.py`.

## Compression of exported images for GitHub

Extracted `img/` files are large, too large to commit or publish comfortably on GitHub.

- **Possible approach:** configurable maximum width and quality (or WebP / AVIF) in
  `publication-md.yaml` for `extract-images`, so images fit GitHub's size limits.
- **Also:** a size report in `STATS.md` (image kB is already counted).
