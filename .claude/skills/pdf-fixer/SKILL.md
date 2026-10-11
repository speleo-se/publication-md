---
name: pdf-fixer
description: Clean up a scanned / OCR'd PDF. Takes a PDF (local path or URL), extracts one image + one text file per page, spellchecks and denoises the OCR text (using page-image vision when it's garbled), and rebuilds a visually-identical PDF whose hidden text layer is corrected so search/copy return clean text. Use when the user wants to fix, clean, de-noise, or spellcheck a scanned PDF or its OCR text layer.
---

# /pdf-fixer — clean a scanned / OCR'd PDF

Takes one PDF (on disk or a URL) and produces, under
`tmp/pdf-cleaner/<document name>/`, a set of per-page images + text and a
**patched PDF that looks pixel-identical to the original but whose invisible OCR
text layer is corrected** (so copy/paste and search return clean text). Visible
pixels are never re-typeset — only the searchable layer is swapped.

`$ARGUMENTS` is the input PDF path or URL. Bundled scripts live in `scripts/`
(refer to them as `<skill-dir>/scripts/...`). Every external command is echoed as
it runs (verbose-commands preference).

## Step 0 — preflight

Check the toolchain: `command -v pdftoppm pdftotext tesseract qpdf pdfunite` and
`python3 -c "import reportlab, lxml, PIL"`. If any is missing, the devcontainer
hasn't been rebuilt with the OCR stack. Tell the user to **Rebuild Container**, or
to install it now in the running container:

```bash
sudo apt-get update && sudo apt-get install -y \
  poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-swe \
  ocrmypdf qpdf img2pdf ghostscript \
  python3-reportlab python3-lxml python3-pil
```

Do not continue until the tools resolve.

## Step 1–4 — extract (mechanical, one script)

```bash
bash <skill-dir>/scripts/pdf_fix.sh "$ARGUMENTS"
```

This: derives `<document name>` (slug of the basename), creates
`tmp/pdf-cleaner/<document name>/`, downloads (`curl`) or copies the source to
`original.pdf`, then writes:

- `pages/page-NN.png` — one image per page (`pdftoppm`, auto DPI = the scan's native ppi).
- `text/page-NN.md` — one raw-text file per page **in natural reading order** (plain `pdftotext` — NO `-layout` — so multi-column pages flow whole-left-column-then-right; `tesseract` OCR for image-only scans).
- `hocr/page-NN.hocr` — tesseract word boxes (scanned), used to position each cleaned word over its scan location.
- `orig/pg-<page>-*.jpg` — original embedded page JPEGs (scanned), reused verbatim as the visible layer.
- `meta.env` — `KIND=scanned|digital`, `HAS_TEXT_LAYER`, `PAGES`, `LANGS`, `DPI`.
- `pdffonts.txt` / `pdfimages.txt` — used for the scanned/digital decision.

Read `meta.env`. **`KIND=digital`** (a real embedded text layer) → skip the PDF
rebuild: see "Born-digital" below. **`KIND=scanned`** → continue.

## Step 5 — clean the text (you)

Keep a complete **before/after** markdown set: `text/page-NN.md` is the raw
"before" (produced in step 1), and you write a "after" `text-clean/page-NN.md`
for **every** page — one file per page, even pages you didn't change (copy those
through verbatim). Both directories are permanent deliverables; never delete them.

`text/page-NN.md` is the raw OCR text. **`pdftotext`'s column order is NOT
trustworthy** — on multi-column pages it routinely merges across a column break it
missed, scrambling paragraph order. So **use your eyes, not just the script**:

- **Open `pages/page-NN.png` (Read tool / vision) for every page that has more than one column or any non-trivial layout** (magazines, registers, tables, sidebars, captions). Read the page the way a human would and write `text-clean/page-NN.md` in that **true reading order** — whole first column top-to-bottom, then the next, then captions/boxes. Reorder freely; the raw text's order is only a starting point.
- **Proofread: the result must make sense.** If a paragraph reads as a non-sequitur or a sentence jumps mid-thought, the order is wrong — go back to the image and fix it. This is the check the script cannot do.
- Fix OCR errors and spelling (docs are Swedish and/or English — keep the page's own language). Drop pure OCR garbage bled in from photos/figures. Don't invent text.
- Single-column body pages usually need no reordering, but still sanity-read them.
- Write **whole, clean words**. Do not re-introduce a word's visual line-break hyphen from the image, and never insert soft/discretionary hyphens (U+00AD) — if the raw text already has the joined word, keep it joined. (Only leave a literal trailing `-` that the raw OCR itself put at a line end; Step 5b handles those.)

Write one `text-clean/page-NN.md` per page (copy through pages you didn't change).
Note which pages you reordered / used vision on (for the report).

### Step 5b — uniform de-hyphenation (deterministic)

After all `text-clean/page-NN.md` exist, run once:

```bash
python3 <skill-dir>/scripts/dehyphenate.py tmp/pdf-cleaner/<document name>/text-clean
```

This joins line-break hyphenation across every page the same way — `ung-\ndom`→`ungdom`,
including across page breaks (`oriente-` + next page's `rade` → `orienterade`) — while
keeping genuine compounds (`Lars-Erik`, `30-tal`, `Chaux-de-Fonds`) intact.

## Step 6 — rebuild the patched PDF (scanned only)

```bash
bash <skill-dir>/scripts/build_pdf.sh tmp/pdf-cleaner/<document name>
```

For each page `place_pdf.py` draws the original page image (visible, byte-identical
when a single embedded JPEG exists) and builds a **line-structured** invisible text
layer like a real OCR PDF: the cleaned words (content + reading order authoritative
from Step 5) are positioned via their matching tesseract word boxes, then grouped
into **one text run per row** (a run of same-row, left-to-right words). This line
structure is what makes PDF viewers do **column-aware mouse selection** (mark the
left column and it stays in the left column; drag into the right column and the
selection flows in reading order) — drawing isolated per-word fragments does not.
`pdftotext -raw` / copy return the cleaned reading order; cleaned words with no scan
box (reconstructed map/cover text) go to a reading-order fallback flow. `pdfunite`
merges the pages and `qpdf --linearize` finalizes `cleaned.pdf`. Visible pixels are
unchanged.

## Step 7 — report

Write `tmp/pdf-cleaner/<document name>/REPORT.md`: kind + page count, a per-page
one-liner of what was corrected, which pages needed vision, and any low-confidence
pages. State plainly that visible pixels are unchanged and only the
searchable/copyable text layer was corrected. Then tell the user the folder path
and where `cleaned.pdf` is.

## Verify before reporting done

- `pdftotext -raw tmp/pdf-cleaner/<name>/cleaned.pdf -` returns the cleaned text **in reading order** — spot-check a multi-column page (e.g. one you reordered): it must read whole-column-then-next and **make sense**. If it reads as nonsense, the Step-5 order for that page is wrong — fix `text-clean` and rebuild.
- `qpdf --check cleaned.pdf` passes and page count matches `original.pdf`.
- Confirm the page images in `cleaned.pdf` are byte-identical to `original.pdf` (`pdfimages -j`, compare md5) — visible pixels unchanged.

## Born-digital PDFs (`KIND=digital`)

A born-digital PDF already has crisp vector text; rasterizing it to swap a text
layer would **degrade** it, so the rebuild is not applied. Deliver the cleaned
`text-clean/*.md` plus the untouched `original.pdf`, and note in `REPORT.md` that
faithfully editing visible glyphs in place is out of scope. Only run Step 6 if the
user explicitly accepts rasterization.
