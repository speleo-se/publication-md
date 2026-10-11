# publication-md

**A plain-text format for transcribed publications — and the tools to make them.**

publication-md stores a transcribed periodical issue, book, report or article as Markdown files
(one per PDF page) with YAML metadata: who wrote each article, where every image sits on the
page and who took it, how printed page numbers map to PDF pages, and the transcriber's notes.
It is readable by anyone, diffable in git, and parseable without special software — built to
outlive the systems that consume it.

This repo contains:

| | |
|---|---|
| [`spec/`](spec/README.md) | The format specification (v1) and JSON Schema — CC0 (public domain) |
| [`spec/content-repo.md`](spec/content-repo.md) | How a content repo is laid out and configured |
| `lib/src/` | Reference library (TypeScript, no build step; Node ≥ 22.18 and Cloudflare Workers): parse, validate, split into articles, cut images out of PDFs |
| `tools/` | Command-line tools: validate, extract images, statistics, fetch source PDFs, manage content repos |
| `.claude/skills/` | [Claude Code](https://claude.com/claude-code) skills: `transcribe` (scan / born-digital PDF → proofread publication-md), `pdf-extract`, `content` |
| `.devcontainer/` | A ready environment with Claude Code, the PDF/OCR toolchain and a default-deny firewall |
| [`registry.yaml`](REGISTRY.md) | Known content repos using publication-md |

The content itself lives in separate **content repos** — one per publication or archive,
owned by whoever owns the content. publication-md never contains content.

## Quick start

```bash
git clone https://github.com/speleo-se/publication-md.git
cd publication-md
npm install
npm run content -- add <content repo git url or local path>   # clone/link + make active
npm run validate                                               # check the content
npm test                                                       # library tests
```

Then, in Claude Code, ask for the next unit: *"transcribe Next"* — or *"add repo <url>"* and let
the `content` skill do the setup.

Opening the folder in VS Code → **Reopen in Container** gives the full environment
(poppler, tesseract, qpdf, gdrive, Claude Code). The container has a default-deny egress
firewall; `npm run content add` prints any hosts a content repo needs — add them to
`.devcontainer/init-firewall.sh` and rebuild.

## The workspace

```
publication-md/
  content/<name>/      content repos — cloned, or symlinked to a checkout elsewhere (gitignored)
  content/.active      the repo the tools act on
  work/<name>/         render trees: page images, raw text, work copies, ledgers (gitignored)
```

```bash
npm run content -- list | use <name> | remove <name>
node tools/workspace.ts               # which repo is active, and its paths
PMD_CONTENT=<name> npm run validate   # act on another repo for one command
npm run fetch -- <unit>               # download a source PDF (per the repo's `sources`)
npm run extract-images -- <unit>      # write <unit>-content/img/* from the PDF
npm run stats                         # write the repo's STATS.md
npm run refs                          # regenerate the repo's ref/ (reference targets + indexes)
```

Every tool and skill resolves paths through `tools/workspace.ts`, so they always agree on which
content repo they work on.

## Content-specific rules

Each content repo may carry a `rules/` folder: the language of the notes, which units are
scanned and which born-digital, recurring pages, corpus conventions, decisions already settled.
The skills read these rules before doing anything and let them win over the generic rules.
Generic improvements belong here; corpus quirks belong in the content repo. See
[spec/content-repo.md](spec/content-repo.md#content-specific-rules).

## Using it for your own publications

1. Create a repo with a `publication-md.yaml` (see [spec/content-repo.md](spec/content-repo.md))
   and your unit folders — or let the `transcribe` skill create them from your PDFs.
2. Add it to your workspace with `npm run content -- add …`.
3. If you like, list it in [`registry.yaml`](registry.yaml) with a pull request (private repos
   are welcome; say how access is obtained).

## Licence and authors

- Code (everything except `spec/`): [MIT](LICENSE).
- Specification (`spec/`): [CC0 1.0](LICENSE-SPEC) — public domain; implement, copy and adapt it
  freely, no attribution required (a link back is appreciated). Please use the name
  "publication-md" only for implementations that follow the spec.
- Written by Lasse Hellman ([AUTHORS](AUTHORS)); hosted by Sveriges Speleologförbund (SSF) at
  [github.com/speleo-se](https://github.com/speleo-se). It grew out of the transcription of
  SSF's magazine *Grottan* (1966–), the first content repo.

Content repos have their own owners and licences — publication-md's licence does not extend
to them.
