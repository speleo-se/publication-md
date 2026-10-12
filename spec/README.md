# publication-md — format specification (v0.1)

A plain-text format for **transcribed publications**: periodical issues, books, standalone
articles, reports, pamphlets. It is Markdown + YAML only, so it can be read, diffed and
parsed with any tool, independent of the software that produced or consumes it.

- **Version:** `publication-md/0.1` (declared in every `publication.md`).
- **Reference implementation:** `lib/src/` in the publication-md repo (TypeScript, no build
  step, runs in Node ≥ 22.18 and in Cloudflare Workers). `tools/validate.ts` validates,
  `tools/extract-images.ts` produces images.
- **Content repos** (where units live) are described in [`content-repo.md`](content-repo.md).
- **Licence:** this specification is CC0 1.0 — public domain (`LICENSE-SPEC`); the code is MIT.
- **Machine-readable schema:** [`publication-md.schema.json`](publication-md.schema.json)
  (JSON Schema 2020-12) for `publication.md` frontmatter and the comment blocks. The
  cross-file rules below (uniqueness, ordering, references) are only in the validator.
- **Vocabulary:** item types and field names follow **CSL-JSON** (the citation format used
  by Zotero/Pandoc) and **Dublin Core**; image regions follow the **IIIF Image API** `pct:`
  region syntax. Prefer these names when adding fields.

## 1. Layout

```
<unit>-content/              one folder per physical source unit (one PDF / scan set)
  publication.md             metadata of the unit (YAML frontmatter, optional body)
  pageIndex-000.md           one file per PDF page, 0-based, ≥ 3 digits
  pageIndex-001.md
  img/                       extracted images (generated, see §5)
collections/<id>.yaml        shared metadata of a container (a periodical, a series)
people.yaml                  canonical names of people + aliases
schema/                      this specification
```

A **unit** is what was scanned or received as one file: a periodical issue, a book, a
standalone article, a report. The unit's text is the concatenation of its page files in
index order. A **part** is a work contained in the unit (§3.2): an article in an issue, a
chapter in a book. Units with a single work (a standalone article) need no parts.

The page file is the unit of transcription and keeps the link to the PDF page (search
hits, per-page access rights). Parts, figures and notes are layered on top of it with
comment blocks, so the reading text stays plain Markdown.

## 2. `publication.md`

YAML frontmatter between `---` lines. The body (optional) is free Markdown about the unit.

| Field | Req. | Type | Meaning |
|---|---|---|---|
| `format` | ✓ | `publication-md/0.1` | Format version. |
| `id` | ✓ | string `[A-Za-z0-9._\|:-]` | Stable repo-local key. Never an external database id. |
| `type` | ✓ | CSL type | `periodical` (an issue), `book`, `article-journal`, `article-magazine`, `report`, `pamphlet`, `thesis`, … |
| `title` | | string | Title as printed. |
| `authors`, `editors` | | person list | See §4. |
| `issued` | | `YYYY`, `YYYY-MM`, `YYYY-MM-DD` | Publication date. |
| `publisher`, `language`, `rights` | | string | `language` is BCP 47 (`sv`, `en`). |
| `identifiers` | | map | `isbn`, `issn`, `doi`, `libris`, `urn`, … → string. |
| `container` | | mapping | What the unit belongs to: `{type, id?, title?, issn?, isbn?, number?, page?}`. `id` refers to `collections/<id>.yaml`. |
| `volume`, `issue` | | string/number | For periodical issues (`issue: 3-4` for double issues). |
| `source` | | mapping | `{file, kind: scanned \| digital}`. `file` is the PDF beside the folder; default `<unit>.pdf`. |
| `pageSequence` | | string | Printed label of every PDF page, in PageSequence syntax (§2.1). |

### 2.1 Page numbering

Three numberings exist; the format keeps them strictly apart:

| Name | What | Where it appears |
|---|---|---|
| **pageIndex** | 0-based position of the page in the PDF | file name `pageIndex-NNN.md`, image path `pNNN` |
| PDF page number | 1-based position (= pageIndex + 1) | nowhere — derive it |
| **label** | what is printed on the page: `12`, `iv`, `A`, `Omslag` | `<!-- page: <label> -->`, `part.pages`, citations |

"Page" in this format always means the **label**; "pageIndex" always means the PDF position.

`pageSequence` maps one to the other, in the syntax of
[PageSequence](https://jsr.io/@tvartom/pagesequence) (same string as Speleotastic's
`df.pageSequence` and the Grottan TOC sheet, where the format was first used). Labels of consecutive PDF pages are separated
by `,`; ranges use `-` (numbers, letters, roman numerals); `|` joins the labels of one PDF
page that holds several printed pages (a spread); `!` marks a PDF page to ignore (a
duplicated scan). It must describe exactly as many PDF pages as there are page files.

```
Omslag|2,3-30,!30,31-35|36      cover+2 on one PDF page, 3–30, a duplicate of 30, 31–35, spread 35|36
i-iv,1-120                     roman front matter, then the body
```

Keys prefixed `x-` are local extensions and are never flagged. Other unknown keys are
warnings (to catch typos).

Examples (the first is a real unit of the Grottan content repo):

```yaml
---  # a periodical issue
format: publication-md/0.1
id: grottan-2007-1
type: periodical
title: Grottan 2007:1
issued: 2007-03
container: {type: periodical, id: grottan}
volume: 42
issue: 1
editors: [{name: Sven Gunnvall, role: editor}]
pageSequence: "1,2|3,4|5,6|7,8|9,10|11,12|13,14|15,16|17,18|19,20|21,22|23,24|25,26|27,28|29,30|31,32|33,34|35,36|37,38|39,40|41,42|43,44|45,46|47,48|49,50|51,52"
source: {file: SSF_Grottan_2007-1_webb.pdf, kind: digital}
---
```

```yaml
---  # a book
format: publication-md/0.1
id: example-book-1959
type: book
title: Example Book Title
authors: [Example Author]
issued: 1959
publisher: Example Publisher
identifiers: {libris: "0000000"}
source: {kind: scanned}
---
```

```yaml
---  # a standalone article (an offprint)
format: publication-md/0.1
id: offprint-karst-1972
type: article-journal
title: Karst in Sweden
authors: [A. Author]
container: {type: periodical, title: Some Journal, issn: 0000-0000, page: 12-17}
volume: 8
issue: 2
issued: 1972
---
```

## 3. Comment blocks in page files

Metadata inside page files is written as **single-line HTML comments** so that Markdown
renderers hide it. The payload is YAML (normally flow style: `{key: value}`). Any other
comment is invalid; use a `note` instead.

| Block | Payload | Position |
|---|---|---|
| `<!-- page: <label> -->` | printed label (§2.1) | Where that printed page starts. Required on a PDF page carrying several printed pages (one per label, in order); optional on a single-label page; absent on an ignored (`!`) page. Checked against `pageSequence` when present. |
| `<!-- part: {…} -->` | §3.2 | Where a contained work starts. |
| `<!-- part: none -->` | — | Where content that is not a work starts (ads, mastheads, fillers). |
| `<!-- part: {key: K, continued: true} -->` | — | Where an earlier part `K` resumes after another part interrupted it (e.g. a review whose plate follows a short notice). |
| `<!-- figure: {…} -->` | §3.3 | On the line directly after its image. |
| `<!-- note: {…} -->` | §3.4 | Where the note applies. |

### 3.1 Scope of a part

A part runs from its `part` block to the next `part` block **across page files** (text at
the top of the next page continues the current part). A continuation block
(`{key, continued: true}`, nothing else) switches back to an earlier part, so one part can
consist of several non-adjacent stretches. Text before the first `part` block
of a unit belongs to no part.

### 3.2 `part`

| Field | Req. | Meaning |
|---|---|---|
| `key` | ✓ | Unique within the unit and stable. Recommended: `<unit key>\|<printed pages>\|<occurrence>` (e.g. Grottan `1987-2\|4-9\|1`, its TOC key). |
| `type` | ✓ | CSL type (`article-magazine`, `chapter`, `review`, `entry`, …) or `none` / `advertisement`. |
| `genre` | | The publication's own category, free text (CSL `genre`): `Notis`, `Bokanmälan`, `Annons`. |
| `title` | | Title as printed (or as the source TOC gives it). |
| `subtitle` | | Subtitle / kicker. |
| `authors` | | Person list (§4); include photographers etc. with a `role`. |
| `rights` | | Rights/access of the part's content if it differs from the unit. |
| `pages` | | Printed page range as labels in PageSequence syntax (`12-17`, `iv-vi`), like a TOC entry. Must resolve in `pageSequence`. |

```markdown
<!-- part: {key: "2007-1|6|1", type: article-magazine, title: Från redaktionen, authors: [Sven Gunnvall]} -->
```

### 3.3 Images and `figure`

An image is a Markdown image whose path names a **region of a PDF page** (§5):

```markdown
![Firning i Stora Sjöfallets grotta](img/p008_pct-54.3,6.05,19.96,87.9.jpg)
<!-- figure: {key: "2007-1|8|1", kind: photo, caption: "Firning i …", creators: [{name: Anna Svensson, role: photographer}], license: "© SSF"} -->
```

| Field | Req. | Meaning |
|---|---|---|
| `key` | ✓ | Stable identity, see below. Unique within the unit. |
| `kind` | | `photo`, `map`, `survey` (cave map), `drawing`, `diagram`, `illustration`, `cover`, … |
| `caption` | | Caption as printed. |
| `creators` | | Person list; use `role` (`photographer`, `cartographer`, `illustrator`). |
| `license` | | Rights statement for the image when it differs from the part. |

**Figure keys.** A figure is identified by its `key`, never by its image path: the path holds
the crop and changes whenever the region is fine-tuned, the key does not. Keys use the same
style as part keys — `<unit>|<printed page(s)>|<n>` — where `<n>` numbers the figures on that
printed page in reading order and a figure across a spread uses the range (`1987-2|16-17|1`).
Rules:

- Assign once, never renumber. A figure added later gets the next free `<n>` on its page,
  even if it sits above existing ones; a removed figure's key is not reused.
- The pages segment is checked against `pageSequence` (warning when it doesn't resolve).
- Outside the repo, a figure is referenced as `<publication id>#<key>`
  (e.g. `grottan-1987-2#1987-2|5|1`) — the unit's `id` makes it globally unique.

The image's `alt` text is the human description (what the old `*[Foto: …]*` lines held).

### 3.4 `note`

Editorial apparatus anchored at its position in the text — never part of the transcribed
text itself.

| Field | Req. | Meaning |
|---|---|---|
| `type` | ✓ | `transcription` (about how the text was transcribed: layout, illegible passages, normalised spelling) or `editorial` (added information). |
| `text` | ✓ | The note, in the language of the publication. |

```markdown
<!-- note: {type: transcription, text: "Listan är i trycket satt i två spalter."} -->
```

### 3.5 References

Mentions of other publications, pages, articles and of real-world entities (caves, people,
places, organisations) are ordinary markdown links to files under the content repo's `ref/`
folder. The **path is the identity**; the files are generated (`npm run refs`) and forward to
the target, so the links work in any markdown viewer — GitHub included — without special syntax:

```markdown
…beskrevs i [Grottan nr 4, 1982](../ref/grottan/1982-4.md).
…kan du läsa i [Grottan nr 4 1986, sidan 22](../ref/grottan/1986-4/p22.md).
…se [artikeln](../ref/grottan/1987-2/1987-2~4-9~1.md).
…grottan [Torekulla kyrka](../ref/ssf/933.md) i Östergötland.
…[Degerfällegrottan](../ref/ssf/unknown.md) norr om Örnsköldsvik.
```

Every target sits in a **namespace folder** declared under `refs:` in `publication-md.yaml`.
A units namespace (`grottan: {units: true}`) holds the repo's own units — unit id
`<namespace>-<local>` ↔ path `ref/<namespace>/<local>` — and every other namespace holds entities:

| Path (from a page file) | Target |
|---|---|
| `../ref/<ns>/<local>.md` | a unit (`../ref/grottan/1982-4.md` = unit `grottan-1982-4`) |
| `../ref/<ns>/<local>/p<label>.md` | a printed page of a unit (resolved through its `pageSequence`) |
| `../ref/<ns>/<local>/<key>.md` | a part or figure by key, `|` written `~` |
| `../ref/<ns>/<id>.md` | an entity (`../ref/ssf/933.md`) |
| `../ref/<ns>/unknown.md` | an entity of that kind whose id is not known yet (a to-do list) |

Canonical string forms (for tools and imports): `grottan-1982-4`, `grottan-1986-4@22`,
`grottan-1987-2#1987-2|4-9|1`, `ssf:933`, `ssf:?`.

**What a part or figure is about** goes in `subjects` — the same identities without the file
decoration, resolved ids only:

```markdown
<!-- figure: {key: "1987-2|1|1", kind: cover, subjects: [ssf/175]} -->
<!-- part: {key: "1987-2|14-18|1", type: article-magazine, subjects: [ssf/1375, ssf/1496, grottan/1986-4]} -->
```

A mention says "this text names X"; a subject says "this article/picture is about X". An entity's
generated `ref/` file lists both, across the whole corpus — for a cave, its bibliography.

Choose namespaces whose ids outlive any one database: an authority's own numbers (e.g. SSF's
*riksnummer* for Swedish caves), Wikidata, GeoNames. A consuming system maps them to its own ids
on import.

## 4. People

A person is a bare name (`Anna Svensson`) or `{name, role}`. `role` is free text; use
`author`, `editor`, `photographer`, `illustrator`, `cartographer`, `translator` where they
fit. Names should match `people.yaml`:

```yaml
- name: Anna Svensson         # canonical form
  aliases: [A. Svensson, Anna Svensson-Berg]
```

The validator warns about names that are not in `people.yaml` (when it is non-empty).

## 5. Image paths

```
img/p<pageIndex>_pct-<x>,<y>,<w>,<h>.jpg        e.g. img/p012_pct-8,31.5,84,43.25.jpg
```

- `pageIndex`: 0-based PDF page, ≥ 3 digits (same numbering as the page files).
- `x,y,w,h`: the **IIIF `pct:` region** — percentages of the page width/height, origin top
  left, up to two decimals, inside the page.

The path is both a **file in the repo** and a **request an image service can answer**: the
parameters are all that is needed to reproduce the image from the PDF. Images are therefore
generated, not authored (`img/` is gitignored):

```bash
node tools/extract-images.ts <unit>
```

How the image is produced (`extractRegionImage`):

1. If an image embedded in the PDF covers the region (intersection-over-union ≥ 0.9) and is
   stored as JPEG, its **original bytes** are returned — born-digital photos come out
   exactly as they were placed.
2. Otherwise the region is **rendered** from the page, at the native resolution of the
   image that contains it (a page scan), else at 300 dpi.

To find the region of an embedded image in a born-digital PDF, take the image's placement
rectangle on the page and convert it to percentages.

## 6. Validation

```bash
node tools/validate.ts [unit…] [--errors-only]
```

Errors: reference links that don't parse or whose unit, page, key or namespace doesn't exist,
unresolved `subjects`, malformed blocks or YAML, unknown comments (incl. the old `<!-- page N -->` spelling), invalid
`pageSequence` or one whose page count differs from the files, page markers that differ from
`pageSequence` (or, without it, numeric markers out of order), `part.pages` that don't resolve, duplicate part or figure keys, a figure using the old `id` field,
figure not directly after an image, image path in `img/` that doesn't parse, missing required fields, unknown `container.id`. Warnings: part/figure keys whose pages segment doesn't resolve in `pageSequence`, unknown keys,
people not in `people.yaml`, images that are not region references.

## 7. Versioning

The format is at **0.1 — not yet stable.** While the version is `0.x`, any minor bump
(`0.1` → `0.2`) may make incompatible changes; the tools will offer a migration where they can.
From `1.0` on, the version changes only for incompatible changes (renamed/removed fields, changed
meaning), and adding optional fields is not a new version.

A consumer must reject a `format` it does not know (below 1.0: the exact `0.x`; from 1.0: the
major version). The content-repo config (`publication-md-content/0.1`) and the git tags that
content repos pin their GitHub Action to (`v0.1`) follow the same version.

**Upgrades** are done by a tool, not by hand: `npm run content -- upgrade` migrates a content repo
to the version of the publication-md checkout (config, every `publication.md`, renamed fields,
the workflow pin), then regenerates `ref/` and `STATS.md` and validates. Every incompatible
change ships with its migration (`lib/src/migrations.ts`).
