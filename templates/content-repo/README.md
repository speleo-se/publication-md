# {{title}}

Transcribed content in the [publication-md](https://github.com/speleo-se/publication-md) format:
one markdown file per PDF page, with articles, authors, images, page numbering and notes as
YAML metadata.

This repo holds **only content and configuration**. Tools, skills, the format specification and
the devcontainer live in [speleo-se/publication-md](https://github.com/speleo-se/publication-md).

## Copyright

The content is © {{owner}}. {{license}}

## Layout

```
publication-md.yaml         configuration: owner, unit naming, where the PDFs live, rules
<unit>-content/             one folder per unit (issue, book …): publication.md + pageIndex-NNN.md
rules/                      content-specific rules for the publication-md skills
ref/                        generated reference targets — do not edit (npm run refs)
people.yaml                 canonical person names
collections/                shared metadata (e.g. the periodical)
STATS.md                    generated statistics (npm run stats)
```

Source PDFs (`*.pdf`) and extracted images (`*-content/img/`) are gitignored.

## How to work on it

```bash
git clone https://github.com/speleo-se/publication-md.git
cd publication-md
npm install
npm run content -- add <this repo's git url or local path>
npm run validate
```

Then ask Claude Code (in the publication-md devcontainer) to "transcribe Next". The skills read
`rules/` here first.

A GitHub Action (`.github/workflows/publication-md.yml`) validates every push and pull request
and keeps `ref/` and `STATS.md` up to date.
