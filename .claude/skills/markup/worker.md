# markup WORKER — add publication-md metadata to ONE unit

You were dispatched by the `markup` skill for exactly one unit (named in your prompt). You have
your own context; the coordinator only sees your final reply. Do the whole unit, then reply in
≤ 15 lines (step 11). Do not start another unit.

`transcribe` produces clean per-page text. `markup` layers the metadata of the format on top
(`spec/README.md` §2–§3.5): who wrote what, where every picture is and who took it, which printed
page is which, the transcriber's notes, and references. The text itself is NOT changed.

**Read the content repo's `rules/markup.md` first** (folder `rules:` in its publication-md.yaml).
It says where the unit metadata and the table of contents come from, how keys, names and article
types map, and which reference namespaces exist. Where it and this file differ, it wins.


## Paths
```
python3 .claude/skills/markup/scripts/markup.py [<unit>|--list]   # state, paths, NEXT
<WORK>/<UNIT>/text-clean/pageIndex-NNN.md    # EDIT HERE (work copy)
<WORK>/<UNIT>/pages/page-NN.png              # 1-based page images (regions are read here)
<CONTENT>/<UNIT>-content/                    # deliverable: finalize --sync copies pages here;
                                             # publication.md is written HERE directly
```
`node tools/workspace.ts` prints `<CONTENT>`/`<WORK>`. If the unit has no render tree
(`NO_WORK`/`NO_PAGES`): `npm run fetch -- <unit>` then
`PDF_EXTRACT_OUT=<WORK> bash .claude/skills/pdf-extract/scripts/extract.sh <CONTENT>/<UNIT>.pdf`.
Never let extract.sh overwrite an existing `text-clean/` — check it first; if it would, stop and ask.

## Steps

1. **Orient.** `markup.py <unit>`; `python3 .claude/skills/transcribe/scripts/finalize.py <unit>`
   must pass and the work copy must equal the deliverable (`status.py <unit>` → DONE). If not,
   stop: the unit needs `transcribe` first.
2. **Unit metadata → `publication.md`** (from the source the content rules name). Include
   `pageSequence` and check it: its number of PDF pages must equal the number of page files
   (`npm run validate -- <unit>` reports a mismatch). A landscape page image is usually a spread.
3. **Read the unit.** All page files, in order (they are short). Find where each TOC entry starts.
4. **Parts.** One `<!-- part: {key, type, genre?, title, subtitle?, pages, authors} -->` on its own
   line directly before each article's heading. Content between articles that is in no TOC entry
   (masthead, filler, ads not in the TOC) gets `<!-- part: none -->`. An article interrupted by
   another and resumed later gets `<!-- part: {key: "…", continued: true} -->` where it resumes.
   Front matter before the first article needs no block.
5. **Spread markers.** On every page file that carries more than one printed page per
   `pageSequence`, put `<!-- page: <label> -->` where each printed page starts (check the image:
   left/right halves). Single-label pages need none.
6. **Figures.** Every picture description line (`[Foto: …]`, `*[Bild: …]*`, maps, drawings, the
   cover) becomes
   ```
   ![<the description, brackets removed>](img/pNNN_pct-x,y,w,h.jpg)
   <!-- figure: {key: "<unit key>|<printed page>|<n>", kind: photo|map|survey|drawing|illustration|cover|diagram, caption: "…", creators: [{name: …, role: photographer}]} -->
   ```
   - Region: `python3 .claude/skills/markup/scripts/grid.py <page-NN.png> <tmp>.png`, Read it,
     read x,y,w,h in % (origin top-left). Whole page = `0,0,100,100`.
   - Then ALWAYS `python3 .claude/skills/markup/scripts/refine_regions.py <unit>` (dry run), then
     `--apply`. Every FLAGGED region: render a crop-box overlay on the page and fix it by hand.
     A thin white margin beats any cut.
   - Keys: `<n>` numbers the figures on that printed page in reading order; a spread figure uses the
     range (`16-17`). Never renumber an existing key.
   - `caption`: the printed caption (it also stays in the text). `creators`: only names printed as
     credit (Foto: …, the cover credit) — never guessed.
   - Small logos, ornaments and vertical running titles stay as they are.
7. **Notes.** Free-text editorial notes about the transcription (`*(…)*`, `[Not: …]`, an
   "Editorial note" paragraph, any `<!-- … -->` that is not a publication-md block) become
   `<!-- note: {type: transcription, text: "…"} -->` with the text unchanged (JSON-quote it). Printed
   text that followed a note on the same line stays as text on the next line.
8. **References.** Link mentions per the content rules, e.g. other issues
   `[Grottan nr 4, 1982](../ref/grottan/1982-4.md)`, a page `…/1986-4/p22.md`, caves
   `../ref/ssf/933.md`. Never guess an id: ambiguous or unknown → `../ref/<ns>/unknown.md`. Add
   `subjects: [ssf/…]` to a part/figure only when it is clearly *about* that entity.
9. **People.** Add every new person name you used to the content repo's `people.yaml` (canonical
   "First Last"; printed variants as `aliases`).
10. **Check and publish.**
    ```bash
    python3 .claude/skills/transcribe/scripts/finalize.py <unit> --sync   # must say IDENTICAL
    npm run validate -- <unit>                                             # 0 errors, 0 warnings
    npm run refs && npm run extract-images -- <unit>
    ```
    Then look at the extracted images (a contact sheet of all crops) — every picture complete,
    nothing cut. Fix and repeat.
11. **Reply** (your final message, ≤ 15 lines): first line `MARKED <unit>` or `BLOCKED <unit>: <reason>`
    or `INCOMPLETE <unit>: <what is left>`; then parts (count, any `none`/`continued`), figures
    (count, flagged and fixed), notes converted, references (resolved / unknown), anything doubtful.
    Do not commit — the coordinator/user does.

## Resuming an interrupted unit (usage limit, `/loop`)
A unit stays TODO until `publication.md` exists, so an interrupted run is picked up again by
`Next`. Before step 4, check the work copy for blocks a previous run already added:
`grep -c '<!-- \(part\|figure\|note\|page\):' <WORK>/<UNIT>/text-clean/*.md` and `git -C <CONTENT>
diff --stat` (the deliverable may already be synced). **Continue from what is there — never add a
block that already exists** (same part key, same figure key, a note already converted). Re-check
the finished steps quickly (validate, refine dry run) rather than redoing them.

## When you cannot finish
If the unit cannot be finished without the user (missing source data, an ambiguity you must not
guess), leave it unmarked and block it: `python3 .claude/skills/markup/scripts/markup.py <unit>
--block "<reason>"`, then reply `BLOCKED …`.

## Rules
- Never change the transcribed words. Metadata only; a link wraps existing text.
- Every block is ONE line. YAML values with `:`, `"`, `#`, `|` or leading digits are quoted.
- Edit the work copy, never the deliverable's page files (except via `finalize --sync`).
- `publication.md` is written last-but-one (after the pages validate), so `markup.py` only shows
  MARKED for a finished unit.
