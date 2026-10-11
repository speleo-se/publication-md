#!/usr/bin/env bash
# pdf_fix.sh — mechanical stages of the pdf-fixer skill.
#
# Sets up the working folder, extracts one image + one text file per page, decides
# whether the PDF is scanned (image-only) or born-digital, and for scanned pages
# produces tesseract hOCR (word boxes) that the text-layer swap will reuse.
#
# It does NOT clean the text or rebuild the PDF — that's Claude (step 5) and
# build_pdf.sh (step 6). Every external command is echoed before it runs.
#
# Usage:  pdf_fix.sh <pdf-path-or-url> [document-name]
# Output: tmp/pdf-cleaner/<document-name>/
#           original.pdf  pages/page-NN.png  text/page-NN.md (reading order)  orig/pg-*.jpg
#           meta.env      (KIND=scanned|digital, PAGES=N, ...)
set -euo pipefail

run() { echo "+ $*" >&2; "$@"; }

SRC="${1:?usage: pdf_fix.sh <pdf-path-or-url> [document-name]}"
RES_REQ="${PDF_FIXER_DPI:-auto}"     # page-image resolution (auto = source ppi for scans)
LANGS="${PDF_FIXER_LANGS:-swe+eng}"  # tesseract languages

# --- document name / working folder -----------------------------------------
base="$(basename "${SRC%%\?*}")"      # strip any URL query string
base="${base%.[Pp][Dd][Ff]}"
name="${2:-$base}"
# slug: keep letters/digits/dot/underscore/dash, collapse the rest to '-'
name="$(printf '%s' "$name" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
name="${name:-document}"

WORK="tmp/pdf-cleaner/$name"
echo "working folder: $WORK" >&2
run mkdir -p "$WORK/pages" "$WORK/text" "$WORK/hocr"

# --- fetch original ----------------------------------------------------------
# Fetch to a temp file and move into place only on success, so a failed re-fetch
# (e.g. an expired signed URL) never clobbers a good original.pdf from an earlier
# run — that copy is reused instead.
PDF="$WORK/original.pdf"
tmp="$WORK/original.pdf.download"
fetch_ok=false
if printf '%s' "$SRC" | grep -qiE '^https?://'; then
  # -4: the devcontainer firewall allowlists IPv4 (A-record) IPs only; without this
  # curl may pick a blocked IPv6 address for dual-stack hosts.
  if run curl -4 -fSL "$SRC" -o "$tmp"; then fetch_ok=true; fi
else
  if run cp "$SRC" "$tmp"; then fetch_ok=true; fi
fi
if [ "$fetch_ok" = true ]; then
  mv -f "$tmp" "$PDF"
else
  rm -f "$tmp"
  if [ -s "$PDF" ]; then
    echo "WARNING: fetch failed; reusing existing $PDF from a previous run" >&2
  else
    echo "ERROR: could not fetch '$SRC' and no existing original.pdf to reuse" >&2
    exit 1
  fi
fi

pages="$(run pdfinfo "$PDF" | awk '/^Pages:/ {print $2}')"
echo "pages: $pages" >&2

# --- born-digital vs scanned heuristic --------------------------------------
# Key trap: a *scanned* doc that was later OCR'd has BOTH page-sized raster images
# AND an embedded (noisy) OCR text layer — so text-volume + fonts alone would call
# it "digital". The decisive signal is therefore page-sized images: if most pages
# are backed by a big raster, it's scanned (the text is an OCR layer to be fixed),
# regardless of how much text extracts. Only docs *without* page-backing images and
# with real extractable text are born-digital.
run pdffonts "$PDF" > "$WORK/pdffonts.txt" || true
font_lines="$(($(wc -l < "$WORK/pdffonts.txt") - 2))"   # minus header rows
chars="$(pdftotext "$PDF" - 2>/dev/null | tr -d '[:space:]' | wc -c)"
per_page=$(( chars / (pages > 0 ? pages : 1) ))

# Count page-sized images (>= ~1000x1400 px): full-page scans, not small figures.
run pdfimages -list "$PDF" > "$WORK/pdfimages.txt" 2>/dev/null || true
big_imgs="$(awk 'NR>2 && ($4+0)>=1000 && ($5+0)>=1400 {c++} END{print c+0}' "$WORK/pdfimages.txt")"
echo "embedded-text chars: $chars (~$per_page/page), font rows: $font_lines, page-sized images: $big_imgs/$pages" >&2

# HAS_TEXT_LAYER: there's already an OCR/text layer worth using as the "before".
HAS_TEXT_LAYER=false; [ "$per_page" -ge 100 ] && HAS_TEXT_LAYER=true

if [ "$big_imgs" -gt 0 ] && [ "$((big_imgs * 2))" -ge "$pages" ]; then
  KIND=scanned            # most pages are raster-backed -> scan (fix its OCR layer)
elif [ "$per_page" -ge 100 ] && [ "$font_lines" -ge 1 ]; then
  KIND=digital            # real vector text, no page images
else
  KIND=scanned            # little/no text -> image-only, OCR needed
fi
echo "kind: $KIND (has-text-layer: $HAS_TEXT_LAYER)" >&2

# --- render resolution -------------------------------------------------------
# For scans, "close to original" means rendering pages at the scan's native ppi
# (not a fixed 200) so the visible layer isn't downsampled. Auto-detect it from
# the page-sized images; cap at 400 to keep file size sane. An explicit
# PDF_FIXER_DPI always wins. Born-digital / undetectable -> 200.
if [ "$RES_REQ" = auto ]; then
  RES=200
  if [ "$KIND" = scanned ]; then
    src_ppi="$(awk 'NR>2 && ($4+0)>=1000 && ($5+0)>=1400 && ($13+0)>m {m=$13} END{print int(m)}' "$WORK/pdfimages.txt")"
    [ "${src_ppi:-0}" -ge 72 ] && RES="$src_ppi"
    [ "$RES" -gt 400 ] && RES=400
  fi
else
  RES="$RES_REQ"
fi
echo "render dpi: $RES" >&2

# --- per-page extraction -----------------------------------------------------
run pdftoppm -r "$RES" -png "$PDF" "$WORK/pages/page"

# For scans, also extract the ORIGINAL embedded page images (byte-identical: JPEG
# streams are copied verbatim). build_pdf.sh reuses these as the visible layer so
# the output keeps the original bytes/size instead of a re-encoded render.
# Files are named orig/pg-<page>-<img>.<ext>; a clean scan has exactly one per page.
if [ "$KIND" = scanned ]; then
  run mkdir -p "$WORK/orig"
  run pdfimages -p -j "$PDF" "$WORK/orig/pg" || echo "  (pdfimages extraction failed; build will re-render)" >&2
fi
# pdftoppm zero-pads to the page-count width (page-1 / page-01 / page-001); normalise nothing —
# just iterate the files it produced.
for img in "$WORK"/pages/page*.png; do
  [ -e "$img" ] || { echo "no page images produced" >&2; exit 1; }
  stem="$(basename "$img" .png)"          # e.g. page-01
  n="$(printf '%s' "$stem" | sed -E 's/[^0-9]//g')"; n="$((10#$n))"
  md="$WORK/text/$stem.md"
  # "Before" text in NATURAL READING ORDER. Plain pdftotext (NO -layout) flows
  # multi-column pages correctly (whole left column, then right) — `-layout` would
  # instead interleave columns row-by-row, which reads as nonsense and misleads the
  # LLM cleaning step. When the scan has an embedded text layer we read it; image-only
  # scans are OCR'd with tesseract (whose txt output is already in reading order).
  if [ "$KIND" = digital ] || [ "$HAS_TEXT_LAYER" = true ]; then
    run pdftotext -f "$n" -l "$n" "$PDF" "$md"
  else
    run tesseract "$img" "$WORK/text/$stem" -l "$LANGS" txt
    mv -f "$WORK/text/$stem.txt" "$md"
  fi
  # Scanned pages also get tesseract hOCR word boxes — the rebuild positions each
  # cleaned word over its box so the invisible text sits on the right column.
  if [ "$KIND" = scanned ]; then
    run tesseract "$img" "$WORK/hocr/$stem" -l "$LANGS" hocr
  fi
done

# --- meta for downstream steps ----------------------------------------------
{
  echo "NAME=$name"
  echo "WORK=$WORK"
  echo "KIND=$KIND"
  echo "HAS_TEXT_LAYER=$HAS_TEXT_LAYER"
  echo "PAGES=$pages"
  echo "LANGS=$LANGS"
  echo "DPI=$RES"
} > "$WORK/meta.env"

echo >&2
echo "done. kind=$KIND pages=$pages -> $WORK" >&2
echo "next: clean text/page-*.md into text-clean/page-*.md, then build_pdf.sh (scanned only)" >&2
