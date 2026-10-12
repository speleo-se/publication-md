# {{title}} — content rules for the publication-md `transcribe` skill

The generic workflow is publication-md's `.claude/skills/transcribe/SKILL.md`; read that first,
then this file. **Where this file and the generic skill differ, this file wins.**

Fill in what is specific to this content:

## The corpus

- Which units are scanned and which born-digital (and when that changed).
- Unit naming quirks not covered by `units.patterns`.

## Notes

- Notes you write are in **{{language}}**; the transcription-note label is `{{noteLabel}}`.
- How figure notes are worded.

## Recurring pages

- Mastheads, contents pages, columns, back covers that repeat every unit.

## References (spec §3.5)

- Which namespaces to use for entities (declare them under `refs:` in publication-md.yaml).
- Never guess an id: use `../ref/<namespace>/unknown.md`.

## Settled judgement calls

- Decisions already made, so they are not re-litigated.
