---
name: pdf-extract
description: Extract clean, proofread, correctly-ordered plain text from a PDF (scanned or born-digital), one markdown file per page. It does NOT rebuild a PDF — the deliverable is a text-clean/ folder of pageIndex-NNN.md files. Each page is produced by a create subagent and checked by a review subagent (vision), and redone if the review score is too low. Use when the user wants the readable text of a PDF (e.g. to feed an LLM), not a cleaned PDF.
---

# /pdf-extract — extract clean, ordered per-page text from a PDF

Produces, under `tmp/pdf-extract/<document name>/text-clean/`, one markdown file
per page (`pageIndex-<III>.md`, **III = 0-based page index**, 3-digit zero-padded:
first page → `pageIndex-000.md`), containing the page's text **cleaned, proofread,
and in correct human reading order** (columns flowed correctly, paragraphs in the
right order, OCR noise removed). No PDF is created.

`$ARGUMENTS` is the input PDF path or URL. Bundled scripts live in `scripts/`.

## Step 0 — preflight

`command -v pdftoppm pdftotext pdfinfo tesseract`. If missing, tell the user to
rebuild the devcontainer or install `poppler-utils tesseract-ocr tesseract-ocr-eng
tesseract-ocr-swe`. (No reportlab/pikepdf needed — this skill writes text only.)

## Step 1 — extract (mechanical)

```bash
bash <skill-dir>/scripts/extract.sh "$ARGUMENTS"
```

Derives `<document name>`, downloads/copies to `original.pdf`, and writes:
- `pages/page-NN.png` — one image per page (source page NN is **1-based**).
- `text/page-NN.md` — raw text per page in natural reading order (plain `pdftotext`; `tesseract` for image-only scans). This is a *starting point*, not trusted for order.
- `text-clean/` — empty, to be filled.
- `meta.env` — `KIND`, `HAS_TEXT_LAYER`, `PAGES`, `DPI`.

Read `PAGES` from `meta.env`. **Mapping:** source page `NN` (1-based) → output
`pageIndex-<III>.md` where `III = NN-1`, zero-padded to 3 (page-01 → pageIndex-000).

## Step 2 — per page: create + review subagent pair (with redo loop)

For **every page**, run a create→review loop. Pages are independent — run several
in parallel. For a page (image `pages/page-NN.png`, raw `text/page-NN.md`, output
`text-clean/pageIndex-<III>.md`):

1. **Create agent** — give it the page image (open with the Read tool / vision) and
   the raw text. It writes `text-clean/pageIndex-<III>.md`:
   - Text in **true human reading order** — read the image, flow multi-column pages
     whole-column-then-next, put paragraphs in the right order, keep captions/boxes
     where they read. The raw text's order is only a hint; reorder freely.
   - **Side-by-side ≠ one table.** Two distinct blocks the typewriter placed next to
     each other (e.g. a role→name *table* on the left and a separate *list* on the
     right) are TWO structures, not one wide table. Never merge them row-by-row into a
     single table — that fabricates a false alignment between unrelated cells. Emit
     each as its own block (the table, then the list) in reading order. Only make one
     table when the columns genuinely share rows.
   - Fix OCR errors and spelling; keep the page's own language (e.g. Swedish, English).
   - **Normalize apparent misspellings to the correct word — do NOT preserve or
     reintroduce a typo.** The deliverable is readable, correctly-spelled text, so an
     obvious misspelling of a known word gets the correct spelling, whether it came
     from a scan speck corrupting a letter's *shape* (o→p → "trpts" for "trots"; c→o →
     "ooh" for "och") OR a typewriter typo (transposition "Kopparbegrs"→"Kopparbergs",
     "grotatn"→"grottan"; dropped/doubled letter "Adra"→"Andra"). **Apply handwritten
     proof corrections** printed on the scan — a caret/inserted letter, a struck word —
     that is the intended text (a hand-inserted "h" turns "autors" into "authors").
     Do NOT "correct" things that aren't misspellings: proper nouns/place names as
     printed, foreign-language words, deliberate dialect, archaic spellings, technical
     abbreviations. Zoom into the PNG when unsure what the letters are.
   - **Write your own notes in the document's main language.** Anything *you* add that
     is not transcribed page text — editorial/sentinel notes, placeholders, figure or
     photo descriptions, bracketed `[…]` remarks — must be written in the **document's
     main language, not English by default** (a Swedish magazine gets Swedish notes:
     "helsidesfoto, ingen brödtext", not "full-page photo, no body text"). Only text
     that is a verbatim transcription of what is printed keeps its original language.
   - **Full-page image / map / figure with no readable body text → a sentinel note**
     in the document's language, e.g. `*(Sida N — helsideskarta, ingen brödtext.)*`
     or `*(Sida N — helsidesfoto.)*`. Still transcribe any title, caption, scale, or
     labels that ARE printed (don't call a titled/captioned map "ingen brödtext").
   - Remove OCR garbage (glyphs bled from photos/figures), join line-break
     hyphenation into whole words, no soft/discretionary hyphens. **Exception —
     end of page:** if the last word is cut off by a hyphen at the very bottom of the
     page (it continues on the next page), leave that fragment *with* its trailing
     hyphen (e.g. `grott-`) — do not guess, complete, or drop it; Step 2b joins it.
   - Readable markdown: real paragraphs (blank line between them), headings where the
     page has them. **No raw HTML entities** (`&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&#…`) —
     the deliverable is human-readable markdown, so write a normal space, `&`, `<`, `>`
     etc. directly (never `&nbsp;` for spacing). Render a **numbered or bulleted list as a real markdown list** —
     one item per line (`1.` / `-`), blank line before it, never inline as
     "`... 1. … 2. … 3. …`" run into a paragraph. Keep tables legible (markdown
     tables or one row per line).
   - **Tabular data stays a table.** Columnar/aligned data (rows of values in
     lined-up columns) must be rendered as a **markdown table**, never flattened into
     a plain list or run into prose — flattening destroys the column relationships.
     A **ditto mark (`"`, `„`, `-"-`, `”`) is a strong signal the content is a
     table**: it means "same as the cell directly above in this column", so it is
     only meaningful inside aligned columns. Keep such data tabular and **preserve
     the ditto marks in place** (do not expand or delete them) so each still points
     at the cell above it.
   - **Table headers — never invent.** Only write a header row whose labels are
     actually printed on the page. If the table has **no printed header, use a
     header-less markdown table** — i.e. leave the header cells blank
     (`|  |  |` then `|---|---|`) — rather than fabricating column names. If a table
     *continues* from a previous page, you may **re-declare the real header carried
     over from the previous page** so the columns stay labelled. Never guess a label;
     an invented header is a correctness failure.
   - **Row markings markdown can't show → record them in a note.** When cells are
     distinguished by a print style that markdown cannot represent — e.g. some row
     keys are **solid-underlined** and others **dotted/punktlinje-underlined** to mean
     different things (per a printed legend) — render the ones you *can* (bold the
     solid-underlined keys) AND add a short italic completeness note **before the
     table** listing exactly which keys carry which marking, e.g.
     `*(I original-tabellen nedan är blankett-nr 1391, 1396, 1397 understrukna =
     karterade objekt, samt 1386, 1387 punktlinje-understrukna = skissade objekt.)*`
     (in the document's language). This is the one sanctioned "editorial note that
     isn't verbatim page text": it exists only because bold can't show a dotted
     underline. Only list markings you can actually read in the image — never guess a
     style. Continuation pages get their own note for their own rows.
   - Don't invent text; don't summarize.

2. **Review agent** — give it the SAME page image (vision) and the created
   `pageIndex-<III>.md`. It scores the file **0–10** and lists concrete problems,
   judging:
   - **Reading order** — do paragraphs follow each other correctly; are columns
     flowed right (not row-interleaved)?
   - **Completeness** — is all real text present (nothing dropped)?
   - **Correctness** — OCR errors fixed, no garbage, no invented text? **Invented
     table headers / column labels that aren't printed on the page are a correctness
     failure** — cap the score at 8 when one is present.
   - **Readability** — sensible paragraphs/headings, whole words.
   Return `score` (0–10) and `comments` (specific, actionable).

3. **Redo unless the score is above 8** — a page is only OK when it scores
   **above 8 (i.e. 9 or 10)**. If `score ≤ 8`, re-run the create agent on the same
   page **with the reviewer's comments**, then review again. Repeat up to **2 redos**;
   keep the best-scoring version. Record the final score and redo count.

Orchestration: spawn create agents for a batch of pages in parallel, then their
reviewers, then redo every page that scored `≤ 8`. Use `SendMessage` to the
same create agent for a redo so it keeps context, or spawn a fresh one with the
comments.

### Multi-page content (tables, matrices, spreads) — one subagent, one take

Per-page fan-out is the default, but content that **spans several pages** must NOT be
split across independent per-page agents — that's how columns drift and headers get
invented. **When a table (or matrix, ledger, index, two-page map spread, or any
structure with columns that continue across a page break) is detected, assign the
whole span of pages to a SINGLE create subagent** that produces all those pages in
one take. That agent sees the header/column layout on the first page and carries the
exact same columns (and, where needed, the re-declared real header — see the
table-header rule above) through every continuation page, so the columns line up and
nothing is fabricated.

Detect spans up front from the raw `text/page-NN.md` + a quick look at the images
(a table whose last row runs to the page bottom and resumes at the top of the next
page is one span). Give the single agent the full ordered list of `(image, raw,
output)` triples for the span and have it write each `pageIndex-<III>.md` itself.
Everything else stays per-page.

## Step 2b — join cross-page hyphenation (deterministic)

Once all pages exist, run once:

```bash
python3 <skill-dir>/scripts/join_pagebreaks.py tmp/pdf-extract/<document name>/text-clean
```

If a page ends with `<letter>-` and the next page starts with a lowercase
continuation, it joins the word and puts the **completed word on the first page**
(removing the fragment from the next page). Idempotent — safe to run once.

## Step 3 — report

Write `tmp/pdf-extract/<document name>/REPORT.md`: page count, per-page final score
+ redo count, and any pages still scoring `≤ 8` after retries (flag as low-confidence —
only **above 8** counts as passed). Tell the user the folder path (`text-clean/`) and
how many pages passed.

## Verify before reporting done

- `ls text-clean/` has exactly `PAGES` files, named `pageIndex-000.md … pageIndex-<PAGES-1>.md`.
- Spot-read one multi-column page's file — it reads top-to-bottom, column-by-column, and makes sense.
- No file contains soft hyphens (`grep -l $'­' text-clean/*` returns nothing).
