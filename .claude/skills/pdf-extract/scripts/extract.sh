#!/usr/bin/env bash
# extract.sh — mechanical extraction for the pdf-extract skill.
#
# Downloads/copies a PDF and writes, per page, a page image (for vision) and the raw
# text in natural reading order. It does NOT build a PDF or run hOCR — the deliverable
# is a text-clean/ folder the create/review agents fill in.
#
# Usage:  extract.sh <pdf-path-or-url> [document-name]
# Output: ${PDF_EXTRACT_OUT:-tmp/pdf-extract}/<document-name>/   (publication-md: PDF_EXTRACT_OUT=work/<content>)
#           original.pdf  pages/page-NN.png  text/page-NN.md  text-clean/  meta.env
set -euo pipefail

run() { echo "+ $*" >&2; "$@"; }

SRC="${1:?usage: extract.sh <pdf-path-or-url> [document-name]}"
RES_REQ="${PDF_EXTRACT_DPI:-auto}"
LANGS="${PDF_EXTRACT_LANGS:-swe+eng}"

base="$(basename "${SRC%%\?*}")"; base="${base%.[Pp][Dd][Ff]}"
name="${2:-$base}"
name="$(printf '%s' "$name" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
name="${name:-document}"

WORK="${PDF_EXTRACT_OUT:-tmp/pdf-extract}/$name"
echo "working folder: $WORK" >&2
run mkdir -p "$WORK/pages" "$WORK/text" "$WORK/text-clean"

# --- fetch (temp + move on success; reuse an existing original.pdf on failure) ------
PDF="$WORK/original.pdf"; tmp="$WORK/original.pdf.download"; ok=false
if printf '%s' "$SRC" | grep -qiE '^https?://'; then
  # -4: dev firewall allowlists IPv4 only, avoid a blocked IPv6 address on dual-stack.
  if run curl -4 -fSL "$SRC" -o "$tmp"; then ok=true; fi
else
  if run cp "$SRC" "$tmp"; then ok=true; fi
fi
if [ "$ok" = true ]; then mv -f "$tmp" "$PDF"; else
  rm -f "$tmp"
  [ -s "$PDF" ] && echo "WARNING: fetch failed; reusing existing $PDF" >&2 \
                || { echo "ERROR: could not fetch '$SRC' and no existing original.pdf" >&2; exit 1; }
fi

pages="$(run pdfinfo "$PDF" | awk '/^Pages:/ {print $2}')"
echo "pages: $pages" >&2

# --- scanned vs born-digital + native scan ppi (for image resolution / OCR choice) --
run pdffonts "$PDF" > "$WORK/pdffonts.txt" || true
font_lines="$(($(wc -l < "$WORK/pdffonts.txt") - 2))"
chars="$(pdftotext "$PDF" - 2>/dev/null | tr -d '[:space:]' | wc -c)"
per_page=$(( chars / (pages > 0 ? pages : 1) ))
run pdfimages -list "$PDF" > "$WORK/pdfimages.txt" 2>/dev/null || true
big_imgs="$(awk 'NR>2 && ($4+0)>=1000 && ($5+0)>=1400 {c++} END{print c+0}' "$WORK/pdfimages.txt")"
HAS_TEXT_LAYER=false; [ "$per_page" -ge 100 ] && HAS_TEXT_LAYER=true
if [ "$big_imgs" -gt 0 ] && [ "$((big_imgs * 2))" -ge "$pages" ]; then KIND=scanned
elif [ "$per_page" -ge 100 ] && [ "$font_lines" -ge 1 ]; then KIND=digital
else KIND=scanned; fi
echo "kind: $KIND (has-text-layer: $HAS_TEXT_LAYER, page-sized images: $big_imgs/$pages)" >&2

if [ "$RES_REQ" = auto ]; then
  RES=200
  if [ "$KIND" = scanned ]; then
    ppi="$(awk 'NR>2 && ($4+0)>=1000 && ($5+0)>=1400 && ($13+0)>m {m=$13} END{print int(m)}' "$WORK/pdfimages.txt")"
    [ "${ppi:-0}" -ge 72 ] && RES="$ppi"; [ "$RES" -gt 400 ] && RES=400
  fi
else RES="$RES_REQ"; fi
echo "render dpi: $RES" >&2

# --- per-page images + raw reading-order text --------------------------------------
run pdftoppm -r "$RES" -png "$PDF" "$WORK/pages/page"
for img in "$WORK"/pages/page*.png; do
  [ -e "$img" ] || { echo "no page images produced" >&2; exit 1; }
  stem="$(basename "$img" .png)"
  n="$(printf '%s' "$stem" | sed -E 's/[^0-9]//g')"; n="$((10#$n))"
  md="$WORK/text/$stem.md"
  # plain pdftotext (NO -layout) flows columns in reading order; tesseract for image-only.
  if [ "$KIND" = digital ] || [ "$HAS_TEXT_LAYER" = true ]; then
    run pdftotext -f "$n" -l "$n" "$PDF" "$md"
  else
    run tesseract "$img" "$WORK/text/$stem" -l "$LANGS" txt && mv -f "$WORK/text/$stem.txt" "$md"
  fi
done

{ echo "NAME=$name"; echo "WORK=$WORK"; echo "KIND=$KIND"; echo "HAS_TEXT_LAYER=$HAS_TEXT_LAYER"
  echo "PAGES=$pages"; echo "LANGS=$LANGS"; echo "DPI=$RES"; } > "$WORK/meta.env"
echo >&2
echo "done. pages=$pages -> $WORK" >&2
echo "next: per page, create text-clean/pageIndex-<III>.md (III = 0-based index) via create/review agent pairs" >&2
