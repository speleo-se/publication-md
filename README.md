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
| [`spec/`](spec/README.md) | The format specification (v0.1) and JSON Schema — CC0 (public domain) |
| [`spec/content-repo.md`](spec/content-repo.md) | How a content repo is laid out and configured |
| `lib/src/` | Reference library (TypeScript, no build step; Node ≥ 22.18 and Cloudflare Workers): parse, validate, split into articles, cut images out of PDFs |
| `tools/` | Command-line tools: validate, extract images, statistics, fetch source PDFs, manage content repos |
| `.claude/skills/` | [Claude Code](https://claude.com/claude-code) skills: `transcribe` (scan / born-digital PDF → proofread publication-md), `pdf-extract`, `content` |
| `templates/content-repo/` | What `npm run content -- init` writes for a new content repo |
| `.github/workflows/content.yml` | Reusable GitHub Action for content repos: validate, regenerate `ref/` + `STATS.md` |
| `.devcontainer/` | A ready environment with Claude Code and the PDF/OCR toolchain |
| [`registry.yaml`](REGISTRY.md) | Known content repos using publication-md |

**Status: version 0.1 — not yet stable.** The format and tools may still change incompatibly
between 0.x versions (see [spec §7](spec/README.md#7-versioning)).

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
(poppler, tesseract, qpdf, gdrive, Claude Code).

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
npm run content -- upgrade [<name>]   # migrate a content repo to this publication-md version
npm run extract-images -- <unit>      # write <unit>-content/img/* from the PDF
npm run stats                         # write the repo's STATS.md
npm run refs                          # regenerate the repo's ref/ (reference targets + indexes)
```

Every tool and skill resolves paths through `tools/workspace.ts`, so they always agree on which
content repo they work on.

`content add` and `content init` also install **git hooks** in the content repo (manage them with
`npm run content -- hooks install|uninstall [<name>|--all]`): *pre-commit* regenerates `ref/` and
`STATS.md` into the commit, *pre-push* validates and blocks a push with errors. So the GitHub
Action rarely has to commit back, and you rarely have to pull after pushing. Bypass with
`--no-verify`. publication-md's own hooks (`.githooks/`, enabled by `npm install`) keep
`REGISTRY.md` current and run the CI checks before a push.

## Content-specific rules

Each content repo may carry a `rules/` folder: the language of the notes, which units are
scanned and which born-digital, recurring pages, corpus conventions, decisions already settled.
The skills read these rules before doing anything and let them win over the generic rules.
Generic improvements belong here; corpus quirks belong in the content repo. See
[spec/content-repo.md](spec/content-repo.md#content-specific-rules).

## Using it for your own publications

1. Create a fully set-up content repo (config, README, rules stub, GitHub Action, …):
   `npm run content -- init <dir> --name <name> --title "<title>" --owner "<owner>" --language <lang>`
   — or ask Claude to "create a new content repo". It is linked into your workspace right away.
2. Adjust its `publication-md.yaml` to your file naming and sources
   ([spec/content-repo.md](spec/content-repo.md)), push it to GitHub, and add PDFs.
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
