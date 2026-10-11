# Content repos — specification (v1)

A **content repo** holds transcribed publications in the publication-md format
([README.md](README.md)) plus the configuration the publication-md tools and skills need to
work on it. It holds **no tooling**: tools, skills and the devcontainer live in the
publication-md repo, which checks content repos out into its workspace.

One organisation may run several content repos (one per periodical, archive, book series); any
number of organisations can use the same publication-md tools. Known repos are listed in
[`../registry.yaml`](../registry.yaml).

## Layout

```
publication-md.yaml          REQUIRED — this file's subject
<unit>-content/              one folder per unit (spec README §1)
  publication.md
  pageIndex-NNN.md …
<unit>.pdf                   source PDFs — gitignored, fetched with `npm run fetch`
ref/                         generated reference targets (§3.5 of the spec) — commit, never edit
collections/<id>.yaml        shared container metadata (optional)
people.yaml                  canonical person names (optional)
rules/                       content-specific rules for the skills (optional, recommended)
README.md                    what the content is, who owns it, how to work on it
```

The repo's `.gitignore` should contain `*.pdf` and `*-content/img/` (generated images).
`ref/` is generated too but **committed**, so reference links work on GitHub; keep it current
with `npm run refs` (`npm run refs -- --check` fails when it is stale — usable in CI).

## `publication-md.yaml`

| Field | Req. | Meaning |
|---|---|---|
| `config` | ✓ | `publication-md-content/1` |
| `name` | ✓ | Short machine name `[a-z0-9._-]`; the default folder name under `content/`. |
| `title`, `shortTitle` | | Human title; `shortTitle` is used in generated reports. |
| `owner` | | Who owns the content (organisation or person). |
| `copyright` | | Copyright statement, shown when the repo is added. |
| `license` | | Licence of the content, or the terms under which it may be used. |
| `language` | | BCP 47 language of the content (`sv`, `en`). Notes the skills write use it. |
| `units.glob` | ✓ | Glob of unit names (folder name without `-content`), e.g. `SSF_Grottan_*_webb`. |
| `units.patterns` | | Regexes (JavaScript syntax) with named groups `year`, `issue`, `volume`, tried in order; they drive sorting (year, first issue number, name), reports and source selection. |
| `units.id` | | Template for each unit's id from the pattern groups, e.g. `grottan-{year}-{issue}`; lets references target units without a `publication.md`. With a units namespace `grottan`, the id must start with `grottan-`. |
| `sources` | | Where the source PDFs live, tried in order (below). |
| `refs` | | Reference namespaces (spec §3.5): `<ns>: {title, url?, units?}`. `units: true` = this repo's units (`grottan: {title: Grottan, units: true}` → `ref/grottan/1982-4.md` is unit `grottan-1982-4`); otherwise an entity namespace, `url` with `{id}` (e.g. `ssf: {title: "SSF:s riksnummer"}`). |
| `rules` | | Folder of content-specific rules (default `rules`). |
| `firewall` | | Hosts the devcontainer must allow for this content. |
| `transcribe` | | Options for the transcription tooling: `noteLabel` (label of transcription notes), `alphabet` (extra letters of the language). |

Keys prefixed `x-` are free for local use.

### Sources

```yaml
sources:
  - {type: gdrive, folder: <Google Drive folder id>, years: 1966-2006}
  - {type: gdrive, folder: <id>, years: 2007-}
  - {type: http, base: https://example.org/pdfs}       # fetches <base>/<unit>.pdf
```

`years` (`YYYY`, `YYYY-YYYY`, `YYYY-`) limits a source to units whose `year` (from
`units.patterns`) falls in the range. A unit's PDF is looked up as `<unit>.pdf`. `gdrive`
sources use the [gdrive CLI](https://github.com/glotlabs/gdrive) with the user's own account,
so private folders work for whoever has been given access.

## Content-specific rules

Files in `rules/` extend the generic skills; the skills read them all and **the content rules
win where they differ**. Conventions:

- `rules/transcribe.md` — everything the `transcribe` skill must know about this corpus: kinds
  of unit (scanned / born-digital) and which applies when, the language and form of the notes
  the transcriber writes, recurring pages, corpus conventions, settled judgement calls.
- `rules/digital-create.md`, `rules/digital-review.md` — additions to the born-digital agent
  rules of the same name.
- Any further `rules/<skill>.md` for other skills.

Keep rules about *this content*; anything that would hold for every publication belongs in
publication-md (open an issue or PR there).

## Example

The Grottan repo's [`publication-md.yaml`](https://github.com/speleo-se/grottan-markdown-content/blob/main/publication-md.yaml)
(private; see the registry).
