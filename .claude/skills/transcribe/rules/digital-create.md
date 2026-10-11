# Born-digital units — CREATE rules

You transcribe PDF pages to markdown, one file per PHYSICAL page. Read the unit
conventions file you were given and the content repo's `rules/digital-create.md` too; they
override this file where they differ.

## Sources
- `pagefacts.py <UNIT> <NN>`: CHARACTER truth — hyphen-true text, glyph codepoints,
  and every non-body font run (bold/italic/heading sizes). Body text is omitted from
  its font list; `--spans` gives the full list if you need it.
- `pages/page-NN.png` (Read it, vision): PLACEMENT truth — reading order, which caption
  goes with which photo, underline, everything in a picture.
- `text/page-NN.md`: reading-order hint only. Its line-end hyphens are DELETED
  (e.g. `SSF-medlemmarna`→`SSFmedlemmarna`, `5-10`→`510`) — never take a compound or a range from it.
- Rasters: `pdfimages -f NN -l NN -png original.pdf out`, magnify from that, never from the page render.

## Order and page markers
- A landscape page is a SPREAD of two folios: whole left folio, then whole right; inside a
  folio, whole left column then right. Tables come out column-major — rebuild rows from the image.
- Each printed page starts with exactly `<!-- page: N -->` (printed folio number). Spread = two
  markers; unnumbered page = none. Put it where the page actually changes, inline mid-sentence or
  mid-word if needed: `landhöj<!-- page: 45 -->ningen`. Never write the folio as visible text.
  Never write the marker syntax inside a note.
- Check every spread for TWO independent articles; each gets its own `#` and byline.

## Text
- Characters exactly as the text layer gives them. Join line-end hyphenation into whole words
  (column breaks and the spread seam included). Keep a hyphen that is part of the word or a range.
  The LAST word of the FILE, if cut, keeps its hyphen — never join across files.
- U+FFFD at a line end = doubled consonant before the break (`kal�lat` → `kallat`).
  Private-use glyph = dingbat → describe in a note, never paste it.
- Spaces: collapse every run of spaces INSIDE a line to ONE. Do not measure or note double spaces.
  Exception, field rows (mastheads, board/address/member registers, bibliography
  `Author · Title`): separate the printed columns with ` · `.
- Hard line break (contact lists, functionaries, addresses, signature blocks): end the line with
  TWO spaces, the corpus form. Never use a trailing backslash `\`.
- Paragraphs: a printed paragraph break (new line after a short line, or indent) = blank line.
  Do not turn prose into lists. Line-identity lists (names, functionaries, contacts) use hard breaks.
- No HTML entities/tags, no soft hyphens. A speech dash opening a line is `–`, never `- `
  (that becomes a list). Afterwards `grep -n '^- '` and confirm each hit is a real list.

## Normalisation — correct ONLY an impossible word whose right form is certain
- Correct: non-words with one obvious form (`hanteringsdiciplin`, `karakär`, `Nägra`), and a
  misspelt name/code when the SAME article prints the right form (`Hovergbergsgrottan`).
- Never: real words in the wrong place, grammar/agreement slips, two equally likely fixes,
  punctuation, missing accents, URLs/e-mails/publication titles/personal names, quoted sources,
  text inside rasters/figures. Note every correction (and notable kept oddity) in the folio note.

## Emphasis and headings
- Font name Bold/Black/Heavy/Semibold → `**bold**`; Italic/Oblique → `*italic*`. Underline (seen in
  image) → bold, except e-mails/URLs which stay plain unless the font is italic. Colour is not emphasis.
- `#` = display title (multi-line title in one size = one `#`), department band, self-standing
  signed notice. Under a band, item heads are `##`. Subheads inside an article (Summary, References,
  cross-heads) `##`; a level below that `###`. A bold run-in at the start of a sentence stays inline.
- Trajan case: take it from the `-layout` text, not spans; lowercase-layer → initial capital,
  acronyms restored to capitals.
- Byline under a title: plain. Signature at the end: italic only if its font is italic.

## Glyphs
- Dashes, quotes, `°`/`º`, superscripts: copy the codepoint. Elisions (`da'r`) take a straight
  apostrophe. Raised clock minutes keep superscripts; raised ordinals flatten (`14th`).
- Ω end-mark: transcribe as `. Ω` where the layer has U+03A9. Footnote reference numbers: Unicode superscripts.

## Shapes
- Columnar data = table. NEVER invent a header: no printed header → `|  |  |` + `|---|---|`;
  partial printed labels → header row with empty cells. Contents list = header-less 2-col table.
- A one-dimensional list set in N narrow columns → one sequence + a note; side-by-side blocks are
  separate structures. Two signatory names on one baseline = two plain lines.
- A printed rule between articles/items = `---`.
- Caption and photo credit: consecutive lines, no blank line between.
- Figure placement: put the figure note where the figure sits in reading order — after the
  text block it follows in its column, never inside a paragraph — with its printed caption directly
  after the note. One note per separate picture; a collage printed as one block with numbered
  captions gets one note per numbered picture. A figure with no text around it (a photo-only
  folio) opens its folio slice.


## Notes — in the content's language (publication-md.yaml `language`), per the content rules
- Figure notes describe what a picture shows. Map/survey labels that sit in the text stream belong in
  the figure note, not the prose. Account for EVERY text object in a figure (read, hedge, or say unreadable).
- Keep figure notes SHORT and factual: count people/objects at magnification; laterality as seen;
  no inferred geology, setting, emotion, brand micro-details; hedge doubt.
- One transcription note (label: the content's `transcribe.noteLabel`) per folio, at the end of that
  folio's slice (or before a paragraph that straddles the fold, saying so). It records reading-order
  decisions, every normalisation (or that none was made), kept oddities, and whether the folio
  number is covered. Make NO claims about the other folio; state only what you measured.
- Notes are SELF-CONTAINED: never mention, compare with or diff against another unit or another
  page job. Describe only how THIS page is printed and transcribed.

## Standing plates (recurring pages — the content rules list them)
Read the previous unit's file first and follow its structure (heading ranks, block order, conventions).
Use it only as a structural template: transcribe every line from THIS unit's text layer, never by
copying "unchanged" lines. The diff is your private working aid, NOT note content.


## Working
Write each file as soon as its page is done. Do not run `plan.py mark`. Final reply ≤10 lines:
files written, structures, heading decisions, normalisations, claims for the reviewer to verify.
