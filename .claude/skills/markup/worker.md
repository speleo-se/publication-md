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
<CONTENT>/<UNIT>-content/pageIndex-NNN.md    # EDIT HERE — the only copy of the text
<CONTENT>/<UNIT>-content/publication.md       # written here too
<WORK>/<UNIT>/pages/page-NN.png              # 1-based page images (regions are read here)
```
`node tools/workspace.ts` prints `<CONTENT>`/`<WORK>`. If the unit has no render tree
(`NO_WORK`/`NO_PAGES`): `npm run fetch -- <unit>` then
`PDF_EXTRACT_OUT=<WORK> bash .claude/skills/pdf-extract/scripts/extract.sh <CONTENT>/<UNIT>.pdf`.
extract.sh only writes the render (`pages/`, `text/`) — it never touches the page files.

## Steps

1. **Orient.** `markup.py <unit>`; `python3 .claude/skills/transcribe/scripts/finalize.py <unit>`
   must pass (`status.py <unit>` → DONE). If not, stop: the unit needs `transcribe` first.
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
   <!-- figure: {key: "<unit key>|<printed page>|f<n>", kind: photo|map|survey|drawing|illustration|cover|diagram, caption: "…", creators: [{name: …, role: photographer}]} -->
   ```
   - Region: `python3 .claude/skills/markup/scripts/grid.py <page-NN.png> <tmp>.png`, Read it,
     read x,y,w,h in % (origin top-left). Whole page = `0,0,100,100`.
   - Then ALWAYS `python3 .claude/skills/markup/scripts/refine_regions.py <unit>` (dry run), then
     `--apply`. Every FLAGGED region: render a crop-box overlay on the page and fix it by hand.
     A thin white margin beats any cut.
   - Keys end in `f<n>` (`1987-2|16|f1`; the `f` keeps them apart from part keys): `<n>` numbers the figures on that printed page in reading order; a spread figure uses the
     range (`16-17`). Never renumber an existing key.
   - `caption`: the printed caption (it also stays in the text). `creators`: only names printed as
     credit (Foto: …, the cover credit) — never guessed.
   - Small logos, ornaments and vertical running titles stay as they are.
7. **Notes.** Free-text editorial notes about the transcription (`*(…)*`, `[Not: …]`, an
   "Editorial note" paragraph, any `<!-- … -->` that is not a publication-md block) become
   `<!-- note: {type: transcription, text: "…"} -->` with the text unchanged (JSON-quote it). Printed
   text that followed a note on the same line stays as text on the next line.
8. **References.** Link mentions per the content rules, e.g. other issues
   `[Grottan nr 4, 1982](../ref/grottan/1982-4.md)`, a page `…/1986-4/page/22.md`, an article
   `…/0001-2/part/1-2~1.md` (part key without the unit segment), a figure `…/1987-2/figure/1~f1.md`, caves
   `../ref/ssf/933.md`. Never guess an id: ambiguous or unknown → `../ref/<ns>/unknown.md`. Add
   `subjects: [ssf/…]` to a part/figure only when it is clearly *about* that entity.
   - **Names files are binding.** If the namespace has a names file (`refs.<ns>.names` in
     publication-md.yaml, e.g. Grottan's `data/cave-names.yaml`), look every printed name up there
     FIRST (case-insensitive; spelling variants and inflections are listed as `printed` forms):
     `id: N` → link N; `id: unknown` → `unknown.md`; `candidates` → pick one of them from context
     (the `hint`), else `unknown.md`. Never link against an entry — if one looks wrong, keep it and
     say so in your reply.
   - **Evidence, not name matching.** A same-named register entry is not proof: compare the
     article's region with the cave's landskap/kommun/socken and its alternative names (`also`), and
     use the content repo's MCP server when it is connected (`mcp:` in publication-md.yaml — e.g.
     Speleotastic `search` with an area filter, `get-cave` for areas, alternate names and location).
     A named part of a cave links to the whole cave, and not at all if that cave is already linked
     earlier in the same article. When the evidence is thin: `unknown` (or `candidates`) and say why.
   - **Cite the article, not the page.** A mention of an article in another unit ("Grottan 3-73
     sid 7", "Gr. 8.3, s. 13-17") links to that article's part (`…/<id>/part/<pages>~<n>.md`): find
     the part in the target unit whose pages cover the cited page(s) — the cited range, the part
     starting there, the context (title, subject) when several short parts share the page. Keep a
     page link only for a real page reference: a continuation within the unit ("forts sid 5",
     "nästa sida"), a range spanning several articles, or a target unit not marked up yet.
   - **A catalogue number printed with the name** (e.g. a Tell number in parentheses) goes inside
     the link text: `[Frubergsgrytet (B4)](…)`. Names files are looked up without it.
   - **Printed contents page.** Link each entry's title in the printed contents table to its part
     (`[Titel](../ref/<ns>/<id>/part/<pages>~<n>.md)`), keep the printed page number as printed —
     never fix it by hand: `npm run nav` adds `(Rättad: N)<!-- toc: correction -->` when it differs
     from the part's first page. `node tools/toc-link.ts <unit> --apply` does the unambiguous rows.
   - **Only names go in the names file.** A descriptive phrase ("en grotta", "grottan", "a cave on the
     island") may be linked in place when the context identifies the cave, but never becomes a fixed
     entry — at most `candidates` with a hint.
   - **A new name** (not in the file): decide from the register + context, then APPEND an entry
     (`printed: [<form as printed>, <inflected forms you met>]` + `id` or `candidates`+`hint`), so the
     next unit links it the same way.
   - Before replying: `npm run refs -- names` must say all entity links agree.
9. **People.** Add every new person name you used to the content repo's `people.yaml` (canonical
   "First Last"; printed variants as `aliases`).
10. **Check and publish.**
    ```bash
    python3 .claude/skills/transcribe/scripts/finalize.py <unit>          # all checks passed
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
`Next`. Before step 4, check the page files for blocks a previous run already added:
`grep -c '<!-- \(part\|figure\|note\|page\):' <CONTENT>/<UNIT>-content/pageIndex-*.md` and
`git -C <CONTENT> diff --stat`. **Continue from what is there — never add a
block that already exists** (same part key, same figure key, a note already converted). Re-check
the finished steps quickly (validate, refine dry run) rather than redoing them.

## When you cannot finish
If the unit cannot be finished without the user (missing source data, an ambiguity you must not
guess), leave it unmarked and block it: `python3 .claude/skills/markup/scripts/markup.py <unit>
--block "<reason>"`, then reply `BLOCKED …`.

## Rules
- Never change the transcribed words. Metadata only; a link wraps existing text.
- Never write or copy the generated parts: TOC corrections `(…)<!-- toc: correction -->`, the
  `<!-- toc: start -->`…`<!-- toc: end -->` table in
  `publication.md` and the page files' last line ending in `<!-- nav: generated -->` come from
  `npm run nav` (finalize and the pre-commit hook run it). Leave an existing nav line as it is.
- Every block is ONE line. YAML values with `:`, `"`, `#`, `|` or leading digits are quoted.
- Edit the page files in `<CONTENT>/<UNIT>-content/` directly — there is no work copy.
- `publication.md` is written last-but-one (after the pages validate), so `markup.py` only shows
  MARKED for a finished unit.
