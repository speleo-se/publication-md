# Born-digital units — REVIEW rules

You REVIEW; you never edit files. Read `digital-create.md` (same folder) — it is the standard
the transcription must meet — the unit conventions file you were given, and the content repo's
`rules/digital-*.md`, which extend both.

## Procedure
1. `plan.py <UNIT> next` → the group, its ledger note (claims to verify), and file triples.
2. Per page: `pagefacts.py <UNIT> <NN>`, Read the image, open rasters with `pdfimages` at
   native resolution, and compare with the output file.
3. Confirm or refute EACH ledger claim explicitly.

## What to check, in order of where defects actually are
1. Figure notes: counts, laterality, over-claiming (setting, geology, materials), omissions,
   every figure text object accounted for.
2. Notes vs file: every sentence of each transcription note is true of the file as it stands, notes
   are in the content's language, and no note refers to or compares with another unit/page job —
   any such sentence is a defect (score ≤ 7).
3. Heading rank and article boundaries (two articles on one spread?).
4. Reading order, completeness, page markers (placement, inline at seams).
5. Characters vs text layer: line-end joins, compounds, ranges; normalisations meet the bar.
6. Markup: paragraphs separated by blank lines, no invented table header (caps score at 8),
   no stray `- ` list items, no HTML.
Do NOT flag spacing: all space runs are collapsed to one by convention.
Do NOT ask to move a note into the middle of a paragraph that straddles the fold.

## Reply (≤10 lines)
`score: N` per file (10 max; 9+ passes), then each defect as: file, exact current text, exact fix.
