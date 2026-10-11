#!/usr/bin/env bash
# build_pdf.sh — rebuild a visually-identical PDF whose invisible text layer is the
# cleaned text: each word POSITIONED over its scan location (tesseract box) and written
# in the cleaned READING ORDER (content stream). Scanned docs.
#
# For each page place_pdf.py draws the ORIGINAL page image (visible, byte-identical
# when a single embedded JPEG exists) and drops each cleaned word onto its matching
# word box. Pages are merged with pdfunite and linearized with qpdf.
#
# Prereqs in the working folder:
#   pages/page-NN.png        render images (page geometry + visible fallback)
#   hocr/page-NN.hocr        tesseract word boxes (positions)
#   text-clean/page-NN.md    cleaned text, ONE FILE PER PAGE, in reading order
#   orig/pg-<page>-*.jpg     (optional) original embedded page JPEGs, reused verbatim
#
# Usage:  build_pdf.sh <work-dir>
# Output: <work-dir>/cleaned.pdf
set -euo pipefail

run() { echo "+ $*" >&2; "$@"; }

WORK="${1:?usage: build_pdf.sh <work-dir>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER="$SCRIPT_DIR/place_pdf.py"

[ -d "$WORK/pages" ] || { echo "no $WORK/pages" >&2; exit 1; }
[ -d "$WORK/hocr" ]  || { echo "no $WORK/hocr (scanned docs need tesseract boxes)" >&2; exit 1; }

DPI=200
[ -f "$WORK/meta.env" ] && DPI="$(sed -n 's/^DPI=//p' "$WORK/meta.env" | head -1)"
DPI="${DPI:-200}"

BUILD="$WORK/build"
run rm -rf "$BUILD"
run mkdir -p "$BUILD"

shopt -s nullglob
page_pdfs=()
for img in "$WORK"/pages/page*.png; do
  stem="$(basename "$img" .png)"
  clean="$WORK/text-clean/$stem.md"
  [ -f "$clean" ] || { echo "  (no cleaned text for $stem; using empty layer)" >&2; clean="/dev/null"; }

  # Visible layer: the ORIGINAL embedded page JPEG (byte-identical) when the page has
  # exactly one; otherwise the re-rendered PNG (reflow_pdf re-encodes it to JPEG).
  n="$(printf '%s' "$stem" | sed -E 's/[^0-9]//g')"; n="$((10#$n))"
  visible=""
  if [ -d "$WORK/orig" ]; then
    mapfile -t cand < <(ls -1 "$WORK/orig" 2>/dev/null | grep -iE "^pg-0*${n}-[0-9]+\.(jpg|jpeg)$")
    [ "${#cand[@]}" -eq 1 ] && visible="$WORK/orig/${cand[0]}"
  fi

  hocr="$WORK/hocr/$stem.hocr"
  [ -f "$hocr" ] || { echo "missing $hocr" >&2; exit 1; }
  run python3 "$RENDER" "$img" "$clean" "$hocr" "$BUILD/$stem.pdf" "$DPI" $visible
  page_pdfs+=("$BUILD/$stem.pdf")
done

[ "${#page_pdfs[@]}" -gt 0 ] || { echo "no pages built" >&2; exit 1; }

if [ "${#page_pdfs[@]}" -eq 1 ]; then
  cp "${page_pdfs[0]}" "$WORK/cleaned.raw.pdf"
else
  run pdfunite "${page_pdfs[@]}" "$WORK/cleaned.raw.pdf"
fi
# --warning-exit-0: qpdf exits 3 on non-fatal warnings, which would trip `set -e`.
run qpdf --linearize --warning-exit-0 "$WORK/cleaned.raw.pdf" "$WORK/cleaned.pdf"
run rm -f "$WORK/cleaned.raw.pdf"
run rm -rf "$BUILD"

echo "wrote $WORK/cleaned.pdf" >&2
