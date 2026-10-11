---
name: transcribe
description: Transcribe one unit (a periodical issue, a book, a report …) of the active publication-md content repo from page scans or a born-digital PDF text layer into proofread, reviewed, per-page markdown, synced byte-identically to the content repo's deliverable folder. Invoke with "Next" to pick up the next unprocessed unit, with a unit id (any unambiguous substring), or with "status" for an overview. Runs one page-group at a time against a durable on-disk ledger, so a session that dies mid-unit resumes exactly where it stopped. Always applies the content repo's own rules (its rules/ folder).
---

# /transcribe — proofread one unit of the active content repo

Long-running project: turn the units of a content repo into clean per-page markdown in the
publication-md format (`spec/README.md`). This skill does **one unit per invocation**.

## Read the content repo's rules first

The active content repo (see `node tools/workspace.ts`; switch with `npm run content use <name>`)
carries its own rules in the folder named by `rules:` in its `publication-md.yaml` (default
`rules/`). **Read every file there before anything else, and pass the relevant ones to every
agent you dispatch.** They define what this generic skill cannot know: the language of the notes
you write and their label (`transcribe.noteLabel`), the eras/kinds of the corpus and which rules
block applies to each, standing plates, corpus conventions and settled judgement calls.
**Where the content rules and this file differ, the content rules win.**

**Two kinds of unit, two workflows.** `extract.sh` records which one a unit belongs to in
`meta.env`, and `plan.py survey` / `next` print it at the top — read that line before
you dispatch anything.

| | `KIND=scanned` | `KIND=digital` |
|---|---|---|
| `text/page-NN.md` | raw OCR, corrupt | real text layer, **verbatim** |
| characters | verify every one against the image | trust them; no OCR proofreading |
| dash / quote / accent | measure the glyph | read the **codepoint** |
| bold / italic / heading rank | measure stems and point size | read the **font name and size** |
| reading order | the main job | **still the main job** |
| one PDF page | one folio | often a **two-folio spread** |

`$ARGUMENTS`:
- `Next` (or empty) — the first unit that is not `DONE`, per `scripts/status.py`.
- a unit id, any unambiguous substring of its name.
- `status` — print the overview and stop.

The user's normal loop is to say **"Next"**, one unit at a time. Do exactly one
unit, report, and stop. Never start the following unit unprompted.

(The worked examples below come from the first corpus done this way, *Grottan* — Swedish
caving magazine, 1966–. They illustrate the method; they are not rules for other content.)

## Work sequentially — one group at a time

Units now run 40+ pages. **Dispatch exactly ONE subagent at a time and wait for
it.** Never put two Agent calls in one message, and never fan out a whole unit.

Sequential work does not spend fewer tokens overall — it makes the spend
*recoverable*. A parallel fan-out of 15 agents all die together when the session
hits a usage limit, and nothing records what any of them had finished. One agent at
a time, with every result committed to a ledger on disk before the next one starts,
means a limit costs at most one group and the next session resumes from the ledger.

Two rules keep that promise:

1. **Commit progress to disk immediately.** After every agent returns, run
   `plan.py … mark …` *before* dispatching anything else. The ledger, not this
   conversation, is the memory of what is done.
2. **Keep the main session's context small.** Never read page images or transcripts
   into the main context — that is the subagents' job. Require every agent to return
   **at most 10 lines**. Put anything the next step needs into a ledger note, not
   into a long message you hope survives.


## Layout

```
<WORK>/<UNIT>/pages/page-NN.png            # 1-based rendered page, the SOURCE OF TRUTH
<WORK>/<UNIT>/text/page-NN.md              # raw extract — a HINT ONLY, order often wrong
<WORK>/<UNIT>/original.pdf                 # digital units: the character truth, via pagefacts.py
<WORK>/<UNIT>/meta.env                     # KIND=scanned|digital — decides the rules block
<WORK>/<UNIT>/text-clean/pageIndex-III.md  # what you write   (III = NN-1, one PHYSICAL page)
<WORK>/<UNIT>/.transcribe/plan.json        # the work ledger (groups, states, notes)
<CONTENT>/<UNIT>-content/pageIndex-III.md  # deliverable, byte-identical copy
```

`<CONTENT>` is the active content repo (`content/<name>`), `<WORK>` its render tree
(`work/<name>`); `scripts/roots.py` asks `tools/workspace.ts` for both, so never hardcode
either path. (`PMD_CONTENT=<name>` picks another repo for one run; `PMD_CONTENT_ROOT` /
`PMD_WORK_ROOT` pin the paths.) Unit names and their order come from `units` in the content
repo's `publication-md.yaml` — never hand-parse names.

**`III = NN − 1`, 3-digit zero-padded** (`page-01.png` → `pageIndex-000.md`).

**One file = one PHYSICAL page, always.** Not one printed page. Consumers key a page by
`(unit, pageIndex)` where `pageIndex` is the physical 0-based index. A born-digital spread is
one physical page carrying two printed folios, so it stays one file — and the file
must say internally where the folio changes.

### Page markers — the contract

Each printed page's content is introduced by exactly:

```
<!-- page: 9 -->
```

Everything from one marker up to the next (or to end of file) is the content of that
printed page. Content before the first marker belongs to no declared page.

**Which "page":** the marker carries the printed **label** — the number as printed on
the paper (`9`, and in principle `iv` or `Cover`) — never the pageIndex (that is the
file name, `pageIndex-NNN.md`, 0-based PDF page). The full pageIndex ↔ label mapping of
a unit is its **pageSequence** (syntax of `@tvartom/pagesequence`); once it is recorded in the
unit's `publication.md`, `validate.ts` checks every file's markers against it. The
colon (`page: 9`) matches the other publication-md blocks; the old `<!-- page 9 -->`
spelling is rejected.

This exists so an article can later be cut out of the corpus by the page number in the
table of contents: resolve the TOC's printed page to its physical index (that is what
`pageSequence` is for), read that file, then take the slice between the markers.
Without it a spread's two folios are one undifferentiated blob and the TOC number
cannot address anything smaller than the spread.

Why an HTML comment and not a heading, a rule or a note: it renders as
nothing in every markdown renderer, it is legal **inline** so it can sit mid-sentence
where a folio genuinely breaks a paragraph, and it cannot be mistaken for content.
`finalize.py` enforces the exact form, rejects any other comment, and checks the
folio numbers climb by one across the whole unit.

The only other comments allowed are the **publication-md** metadata blocks —
single-line `<!-- part: {…} -->`, `<!-- figure: {…} -->`, `<!-- note: {…} -->` with a
YAML payload (`spec/README.md`). `finalize.py` checks their shape and runs
`tools/validate.ts` on `text-clean/` (skipped with a notice until `npm install`).

A scanned unit whose files are each one printed page needs no markers: the TOC number
resolves straight to a file through `pageSequence`.

Agent rule files: `rules/digital-create.md`, `rules/digital-review.md` (born-digital), plus
the content repo's files of the same name, which extend them.

Scripts (all under `.claude/skills/transcribe/scripts/`, run with `python3` from the
publication-md root): `status.py` (corpus state) · `plan.py` (the ledger) · `finalize.py`
(join, check, sync) · `pagefacts.py` (born-digital only: hyphen-true text, emphasis, glyphs)
· `roots.py` (resolves `<WORK>`/`<CONTENT>`; imported, never run directly).

On a born-digital unit, run `pagefacts.py <UNIT> <NN>` once per page and paste its
output into the create agent alongside the image. It answers, from the PDF itself,
three things that cost vision work on a scan:

- **the true hyphens.** `text/` is written with plain `pdftotext`, which
  de-hyphenates: it fuses `SSF-` + `medlemmarna` into `SSFmedlemmarna` and `5-` + `10`
  into `510`, leaving nothing to notice. Measured on 2007-1: 10 line-end hyphens
  survive in `text/`, 170 with `-layout`. **Never take a compound or a number range
  from `text/`.**
- **emphasis and heading rank**, as font name and point size — by default only the runs that
  differ from the body font are listed (`--spans` prints every run)
  (`TrajanPro-Bold@14` = title, `AGaramondPro-Italic@10` = byline, body = 10 pt).
- **which glyph is actually printed** — en dash vs hyphen, curly vs straight quote,
  `°` vs `º` — as codepoints.

## Step 0 — orient, and resume if there is anything to resume

```bash
python3 .claude/skills/transcribe/scripts/status.py            # summary + NEXT
python3 .claude/skills/transcribe/scripts/status.py 1987_2     # one unit
```

States: `DONE` · `IN_PROGRESS` · `PLACEHOLDER` · `PARTIAL` · `UNSYNCED` · `TODO` · `NO_PAGES`.

**`IN_PROGRESS` means a ledger exists and the unit is unfinished.** Do NOT re-plan
and do NOT redo finished groups — go straight to Step 2 and keep pulling
`plan.py <UNIT> next`. This is the normal state after a session hit a usage limit.

> **`PLACEHOLDER` is the trap.** Many deliverable folders were pre-seeded with raw
> unproofread OCR that is byte-identical to `text/page-NN.md`. The folder looks
> finished and is not. `status.py` detects this. Always confirm the state before
> assuming a unit needs no work — and say so in your report when you find one.

> **Salvage before you redo.** `status.py` also reports how many `text-clean/` pages
> are already real transcriptions rather than raw OCR ("text-clean already holds
> 44/44 transcribed pages"). A pre-ledger session can have died after transcribing
> and before syncing. That work is good; **do not overwrite it blindly.** Plan the
> groups as usual, then for every group whose pages are already transcribed, skip
> the create agent: `mark <n> created --note "pre-existing from an earlier session —
> unverified"` and send it straight to a review agent. Only pages flagged
> `[RAW OCR PLACEHOLDER]` by `plan.py next` must actually be written from scratch.


## Step 0a — render the unit if it has not been rendered

`NO_PAGES` means the scans have not been rasterised yet — there is nothing for a
create agent to look at. Fetch the source PDF if it is missing (the content repo's
`sources` say where it lives), then render it into `<WORK>`:

```bash
npm run fetch -- <UNIT>                                   # → <CONTENT>/<UNIT>.pdf
PDF_EXTRACT_OUT=<WORK> bash .claude/skills/pdf-extract/scripts/extract.sh <CONTENT>/<UNIT>.pdf
```

Takes ~30s per unit. OCR languages default to `swe+eng`; set `PDF_EXTRACT_LANGS` (tesseract codes)
for other content.

## Step 1 — survey and write the plan (once per unit)

```bash
python3 .claude/skills/transcribe/scripts/plan.py <UNIT> survey
```

Prints every page's raw size, its opening text, and whether an output already
exists — enough to spot articles, tables, registers, plates and multi-page
structures without loading any page into context.

Then define the groups. Group by **article, not by fixed page count**:

```bash
python3 .claude/skills/transcribe/scripts/plan.py <UNIT> init <<'EOF'
1      omslag
2-3    ledare + innehall
4-11   medlemsmatrikel        # 8-page structure, one agent, never split
12,14  notiser
13     helsidesannons
EOF
```

`init` refuses a plan that does not cover every page exactly once, so a page cannot
be silently dropped. It writes `.transcribe/plan.json`; `--force` replaces an
existing plan (only do that if the grouping was wrong — it resets every state).

Sizing rules:

- **Multi-page structures get ONE group for the whole span — never split.** This is
  what stops columns drifting and headers being invented. Real examples from Grottan: an 8-page member directory, a 3-page cumulative index, a 4-page
  grottblankett register, a 2-page ranked cave list, a 2-page song with sheet music,
  a 2-page bibliography, a 2-page price list.
- Otherwise aim for **3–4 PDF pages per group** (on a born-digital unit that is 6–8
  printed folios), **at most ~8**, and let a group span several short articles. Every
  agent pays a large fixed cost (system prompt, rules, conventions, re-sent on each tool
  call), so tiny groups multiply it: 2014-3/2014-4 at 1–2 pages per group cost ~100k
  tokens per PDF page. A group is still the unit of loss when a limit hits, which is why
  it is capped rather than unbounded.
- A 25-page born-digital unit lands at roughly 6–8 groups.

## Step 2 — the loop: create → review → mark done, one group at a time

```bash
python3 .claude/skills/transcribe/scripts/plan.py <UNIT> next
```

`next` prints the single group to work on, its state, its ledger notes, and the exact
`(image, raw, output)` triples with absolute paths. It also tells you which action is
due. Repeat this cycle until it prints `ALL GROUPS DONE`:

| ledger state | do this | then |
|---|---|---|
| `todo` | dispatch **one** create agent for the group | `mark <n> created --note "<claims to verify>"` |
| `created` | dispatch **one** review agent for the same group | `mark <n> reviewed --score <min score>` |
| `reviewed`, score ≥ 9 | nothing | `mark <n> done` |
| `reviewed`, score ≤ 8 | fix the named defects yourself, then re-review | `mark <n> reviewed --score <new>` |

Never skip the `mark` — an unmarked group is a group the next session redoes.

**Create agent.** On a **born-digital** unit, hand it two file paths instead of pasted
prose: `rules/digital-create.md` (this skill's condensed create rules, ~6 kB) and the
per-unit conventions file (below), plus the unit name; it runs `plan.py next` itself to
get its triples. The review agent gets `rules/digital-review.md` instead. Never paste
the long sections of this SKILL.md into an agent — they are the background for YOU and the
rationale behind the condensed files; when a new defect class is settled, add ONE line to
the matching `rules/` file rather than growing this document. On a **scanned** unit, give it
the ordered `(image, raw, output)` triples, the rules block below **plus the four shared
sections above it — Heading rank, The normalisation bar, Glyph decisions, and Table/list and
caption shapes**, and — for any table — a **self-check tied to the data**: "rank numbers must
ascend 1…N", "surnames stay alphabetical A→Ö", "every År is 84–86 and every Nr is
1–4", "form numbers ascend". A broken sequence proves the columns were misread.
Require it to **write each page's file immediately after transcribing that page**,
not batch them at the end, so an interrupted agent still leaves finished pages
behind. Require a final report of **at most 10 lines**: pages written, structures
handled, and any *claim a reviewer should verify* (e.g. "only 1961 is underlined").
Put those claims verbatim into the ledger note — that is what survives a lost session.

**Recurring standing plates: diff, don't re-transcribe from scratch.** Several pages
repeat almost verbatim every unit (the content rules list them — mastheads, board pages,
recurring columns, back covers). For those, tell the agent to
READ THE PREVIOUS UNIT'S VERSION FIRST, follow its structure exactly, then DIFF its
result against it and report what changed. This is the strongest verification available
anywhere in the workflow: on 2008-1's Hur-Vem-Var the diff came back as a single hunk,
which proves every address and phone number at once. Two cautions: a real editorial
change is expected (a new board, a new club, a changed deadline), so the agent must
name each one; and a diff cannot see an **inherited-but-stale line**, so the reviewer
must still spot-check lines the diff calls unchanged against THIS unit's image.

**Review agent.** Same images, the created files, and **the create agent's own claims
to verify** from the ledger note ("the transcriber says only 1961 is underlined —
confirm or refute"). Targeted verification catches far more than a generic re-read.
The reviewer judges: reading order · completeness · correctness (invented header caps
the score at 8) · notes in the content language · markup hygiene · readability. It returns `score: N`
per page, **must not edit files**, and reports in at most 10 lines.

**Pass bar: above 8** — only 9 or 10. Fix anything at ≤8 and re-review. Reviewer
"nits" about em vs en dashes are cosmetic; don't mass-edit those.

If a create agent is cut off mid-group, leave the group at `todo` and re-dispatch it
with the note that pages already written are to be kept: `next` marks each output
`[ALREADY TRANSCRIBED]` or `[RAW OCR PLACEHOLDER]`, and the agent should read the
whole span's images for continuity but only write the missing files.


### Heading rank — settle it once, then hold it all unit

Rank is decided by TYPOGRAPHY — never by grammar, by the table of contents, or by how
important an item feels. Four tests, in order:

1. **A display title standing on its own line** → `#`. A multi-line title set in ONE size is
   ONE `#`, not one per printed line (a three-line verksamhetsberättelse title is one heading).
2. **Is there a department BAND above it** — a full-folio-width coloured or grey bar? Then the
   band is `#` and EVERY item head under it is `##`, even a SIGNED item, and even when the item
   head is set LARGER than the band head. Signedness marks contributed copy; it does not set
   rank. A signed item gets `#` only when no band sits above it on that folio.
3. **A kicker** — a line set SMALLER than the display title — is `##`, even though it is printed
   ABOVE the title.
4. **A bold lead-in running into the first sentence** is not a heading at all: keep it inline as
   `**Fet ingress** resten av meningen`. Promoting one invents a display heading and often leaves
   a broken sentence (`# Geologiskt Forum` followed by body starting "är en ny…"). This holds
   even when the run-in is a complete self-contained sentence. One page can carry both levels.

**Rank is relative to the block's OWN body text, not to the page.** Register, matrikel and
contact blocks are set several points smaller than feature articles, so their heads measure
smaller in absolute pixels while being the same rank. Compare cap height, x-height AND stem
width against the text beside it (bold ≈ 5–6 px vs body ≈ 4 px), not against a heading elsewhere
in the unit.

**Byline vs signature is decided by POSITION, not by the print's italic.** A byline directly
under the title is set PLAIN even when the print italicises it; a signature at the END of a
piece is `*italic*`. Review agents reliably flag the first as a defect and ask for italics —
they are wrong, and the corpus is consistent (it cost two separate reviewer disputes in one
unit).

`###` is right only for cross-heads INSIDE one item — prove it by checking the body text runs
unbroken through them.

**When you settle a level, record it as a ledger note** (`plan.py <UNIT> mark <n> done --note
"artikelrubrik = ##"`) and pass it to later create agents. Missing it on one group means
retroactively fixing every earlier group in the unit.


### The normalisation bar — what may be corrected, and what may not

Correct a printed word ONLY when BOTH hold: it is an **impossible** word (a non-word), AND its
right form is **certain**.

- **Impossible → correct**: flodassagerna, tvugna, bibliteket, Kopparbegrs, Höstjällmöte,
  säkerhen, tillfredställelse, Resturang, lenght, belive, nte.
- **A real word in the wrong place is a SUBSTITUTION and always stands**: "i värden" (for
  världen), "the" for they, "mor", "bli", "förkommer", "wast", "Lägst", "Fån", "läng".
- **Grammar and agreement slips are not typos**: "goda möjlighet", "en visst fokus",
  "hade ett ny forskningsfält", "9:th". Leave them; note them.
- **Two equally reachable right forms = not certain → leave verbatim.** `arceological` stays,
  because `archeological` and `archaeological` are equally reachable; minimal edit distance is
  not evidence. Likewise `mineschafts` (mineshafts vs mine shafts).
- **Punctuation is not a word.** Never close an unbalanced parenthesis, collapse a printed
  doubled colon (`SVENSKA GROTTOR::`), or supply a missing stop.
- **A missing acute accent is never restored** — printed `ideer` stays `ideer`.
- **Publication titles, URLs/e-mail strings and personal names stay exactly as printed**, even
  when the right form is certain. They are identifiers, not words. *Exception:* independent
  CORPUS corroboration can make a broken URL's right form certain — 1999_4 printed one address
  broken two different ways against 28 clean corpus hits, so both were normalised. Beware the
  unit's own placeholder posing as precedent.
- **A standardised CODE with a transposed letter IS corrected**: `BRCA` → `BCRA` (printed right
  three times on the same spread), `Anastostomatidae` → `Anostostomatidae` (ICZN nomenclature
  has exactly one right form, and this magazine prints it correctly in 2013-1). The proper-noun
  exemption protects freely-chosen names, not codes with an external right answer — a place name
  like `Withwatersrand` is freely chosen and stays.
- **Never normalise inside a QUOTED source.** A quotation reproduces period orthography, so
  changing it rewrites the quote: 2014-2's `åminnnelse` (triple n, quoted 1813 material) was
  restored verbatim, as was `Filsofie Magister` beside it.
- **Raster and figure lettering is NEVER normalised**, even for a word that would be corrected
  in prose. The licence to normalise rests on the text layer being verbatim evidence of what was
  typed; a raster label is absent from the char stream.
- **Faded or broken ink: read the GLYPH.** Crop hard, zoom repeatedly, compare against sharp
  instances of the same digit ON THE SAME PAGE. Never reconstruct a value from another year's
  directory, from alphabetical position, or from what it "ought" to be — in 2004_1 corpus
  evidence overwrote a legible printed 23379 with 23879. If the ink carries no reading, write a
  sentinel note, never a guess.
- One case where the print is NOT the authority: in **ArialMT, capital `I` and lowercase `l` are
  identical glyphs**, so a text-layer `Stefan NIlsson` prints as `Nilsson`. The doubled capital
  exists only in the layer; keeping it makes the transcription LESS faithful. Normalise it.

**Never pre-classify a character as OCR noise when briefing a create agent.** Agents defer to
the instruction over their own eyes: a brief calling a printed `6` "probably scanner dirt" made
an agent delete genuinely printed text that its own report called "otvivelaktigt tryckt".

### Glyph decisions

- **Dash vs hyphen: MEASURE against a line-end hyphen on the SAME page.** Roughly double the
  width = a real en dash; the same width = the print is using a spaced hyphen as a dash, and the
  hyphen is kept. One unit mixes both — never normalise one into the other.
- **A speech dash opening a line must be an en dash (`–`)**, never ASCII `-`: `- ` at line start
  is markdown list syntax and silently turns running prose into a bullet. After writing a group,
  `grep -n '^- '` the files and confirm every hit is a real list item.
- **Quote glyphs vary PAGE BY PAGE within one unit** — straight `"…"` on some pages, curly
  `”…”` on others, `‘…’` in places. Never give a create agent a unit-wide house-style rule.
  In born-digital Swedish setting, for example, U+201D is often used for BOTH opening and closing.
- **Guillemets « » (U+00AB/U+00BB) are a `pagefacts.py` blind spot** — its glyph list does not
  watch them, so a page that genuinely prints them is reported as having nothing notable. Check
  the character stream directly.
- **Colloquial elisions take a STRAIGHT apostrophe** — `da'r`, `sta'n`, `it's` — even when the
  printed glyph is an acute U+00B4 (corpus: 8 straight, 0 acute). The elision itself is real
  speech and is never "corrected" to `där`.
- **Raised clock times are verbatim with their superscripts** (`18⁰⁰`, `18³⁰`) and get NO
  explanatory note; a **raised English ordinal is flattened** (`14ᵗʰ` → `14th`). The test is
  whether the raised characters carry information — minutes do, an ordinal suffix does not.
- **The Ω end-of-article mark IS printed text.** Transcribe it where it occurs, written `. Ω`
  with a space, even where the print sets it tight (Grottan corpus: 832 vs 4). It is per-unit, so do
  not go looking for one otherwise. A **bold serif W standing where Ω belongs is genuinely
  printed** — a Symbol-font substitution made before printing. Keep the W; never "restore" Ω.
- **Coordinate truncation dashes**: the NUMBER of trailing dashes encodes precision, and the
  style varies between years (a single en dash vs N hyphens). Copy them one for one.


### The rules block — SCANNED units

Use this when `plan.py` prints `KIND=scanned`. The content rules may extend or replace it.

**This block is not self-sufficient.** Paste it together with **Heading rank**, **The
normalisation bar** and **Glyph decisions**, the content repo's rules, and — for any table — a
self-check tied to the data.

> You MUST Read `pages/page-NN.png` with the Read tool (vision) — the image is the
> source of truth. `text/page-NN.md` is raw unproofread OCR, a HINT ONLY; its
> reading order is often wrong (columns interleaved line-by-line).
>
> 1. **True reading order.** Multi-column: flow the WHOLE left column, then the
>    whole right. Fixing the OCR's interleaving is usually the main job.
> 2. **Fix OCR errors and normalize every typo whose correct form is CERTAIN**
>    (scan-speck misreads and typewriter typos alike), in EVERY language the page prints. The deliverable exists to be searched
>    and read by machines, so a preserved misspelling is a defect, not fidelity.
>    Also collapse obvious dittography (a word set twice by mistake).
>    **Certainty is the bar.** If you cannot name the correct form with confidence,
>    transcribe exactly as printed. Deliberate dialect and archaic spellings are not
>    typos — keep those. Zoom in when unsure.
> 3. **PROPER NOUNS: correct only when the right form is certain.** A misspelt name
>    that is unmistakable in context (e.g. `Kopparbegrs` → `Kopparbergs`) is normalized
>    like any other typo. But a personal name, an address, an obscure publication
>    title or a name you cannot verify stays exactly as printed — inventing a
>    "corrected" name is worse than reproducing an odd one.
> 4. **YOUR OWN NOTES are in the content's language** (`publication-md.yaml` `language`).
>    Every note, figure description, sentinel or placeholder YOU write; only verbatim
>    printed text keeps its own language.
> 5. Full-page image/map with no body text → a sentinel note, but still
>    transcribe every printed title, caption, scale, credit and label.
> 6. Join line-break hyphenation into whole words. NO soft hyphens. EXCEPTION: if
>    the very LAST word of a page is cut by a hyphen, leave the fragment WITH its
>    hyphen. An intra-page COLUMN break is NOT a page break — join those.
> 7. No HTML entities (`&nbsp;` `&amp;` `&gt;`) and no HTML tags. Underlined
>    emphasis → `**bold**`, never `<u>`.
> 8. Columnar data stays a markdown table — never flattened to a list or prose.
>    Preserve ditto marks (`"`) in place.
> 9. **NEVER invent a table header.** If no header is printed, use a header-less
>    table (`|  |  |` then `|---|---|`). An invented header is a correctness failure.
> 10. Real markdown lists; blank line between paragraphs; headings where printed.
> 11. Don't invent text, don't summarize, don't drop text.
> 12. Write each page's output file as soon as that page is done, then move on.

### The rules block — BORN-DIGITAL units

Use this when `plan.py` prints `KIND=digital`. **Agents get `rules/digital-create.md` /
`rules/digital-review.md`** (this skill) **plus the content repo's files of the same name**, and
the `pagefacts.py` output for each page. Keep a short per-unit `conventions-<unit>.md` in the
job's tmp dir for decisions settled as you go (heading levels, accepted normalisations), seeded
from the previous unit's, and pass its path alongside.

## Step 3 — join cross-page hyphenation

Only once `plan.py <UNIT> next` prints `ALL GROUPS DONE`:

```bash
python3 .claude/skills/transcribe/scripts/finalize.py <UNIT> --join
python3 .claude/skills/transcribe/scripts/plan.py <UNIT> phase join
```

Run **once** — record the phase immediately so a resumed session does not re-run it.
Then read the reported dangling hyphens — each must be a genuine page-final fragment
continuing on the next page.

> **The joiner is blind past a figure note.** It only looks at a file's *last* line.
> When a photo/map/cartoon note sits after the fragment, it reports "0 joined" and
> the break is silently missed — join those by hand, completed word on the FIRST
> page. One real case spanned an entire full-page plate (`mål-` + `ningar` across a
> page with no body text).
>
> **It can also fabricate a word.** If a page-final fragment is a *truncated caption*
> rather than a continuation, it fuses it with the next page's first word (a real
> case produced "reprecis" from "dåligt re-" + "precis"). After manually reverting
> such a join, do **NOT** re-run `--join`.

## Step 4 — finalize and verify

```bash
python3 .claude/skills/transcribe/scripts/finalize.py <UNIT> --sync
python3 .claude/skills/transcribe/scripts/plan.py <UNIT> phase sync
```

Checks page count and naming, placeholder pages, soft hyphens, HTML entities/tags,
malformed table blocks and dangling hyphens; then copies to the deliverable and
proves byte-identity. Exit 0 = clean. Do not report done until it is, and only record
`phase sync` once it exits 0 — that is what flips the unit out of `IN_PROGRESS`.

## Step 5 — report

State: unit and page count; that it was a raw-OCR placeholder if so; the special
structures verified; the review outcome; and every defect you fixed, with the
reasoning. Finish with a one-line `result:` headline. Then stop — wait for "Next".

**If you stop before the unit is finished** (usage limit, a blocked group, the user
interrupting), say so plainly, give `plan.py <UNIT> show` output as the state, and
name the resume command. Do not report an unfinished unit as done — `finalize.py
--sync` is the only thing that makes a unit done.


## Tool quirks that will bite you

- **Never write a literal `<!-- page: N -->` inside a transcription note**, not even in
  backticks as an example. `finalize.py` counts every occurrence of the marker syntax, so a
  quoted one becomes a duplicate and the run fails with "page N does not follow page N". Refer
  to it in prose instead ("the folio marker for page 43 sits inside the sentence").
- **A hand-lettered plate's vertical depth/level scale trips the stray-folio check.** Those bare
  numbers are printed content and must NOT be deleted; inline the scale (e.g. as part of the
  figure note) so both the print and `finalize.py --sync` are satisfied.
- **The scanned OCR layer emits each paragraph's bold run and regular run as separate streams,
  in varying order.** On register pages (Grottan's grottblankett register) this makes the raw text look as if
  every entry's number and name belonged to the PREVIOUS entry's data — a fake off-by-one
  shift. Demand image evidence and a semantic check before rebuilding a register on that basis.
