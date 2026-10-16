---
name: markup
description: Add publication-md metadata to already-transcribed units of the active content repo — publication.md (incl. pageSequence), part blocks per article (TOC keys), figure blocks with refined image regions and keys, note blocks, reference links/subjects — then validate, sync, regenerate ref/. Invoke with "Next" for the next unmarked unit, a unit id (e.g. "1987_3"), or "status". One unit per invocation, done by a subagent with a fresh context, so `/loop /markup Next` can run many units without the session filling up. Always applies the content repo's rules/markup.md.
---

# /markup — coordinator

The work for one unit (reading every page, page images, regions, edits) is done by **one
subagent** with its own fresh context, following `worker.md`. This session only picks the unit,
dispatches, verifies and reports — so it stays small, and `/loop /markup Next` can run unit after
unit without the context growing. Never read page files or images here yourself.

`$ARGUMENTS`: `Next` (or empty) · a unit id (any unambiguous substring) · `status`.
Show the user every command you run.

## Steps
1. **Pick.** `python3 .claude/skills/markup/scripts/markup.py` (summary + NEXT) or
   `markup.py <unit>`. `status` → print the summary and stop. `MARKED` → say so and stop.
   `BLOCKED` → show the reason and stop (unless the user asked to retry: `--unblock`).
2. **Dispatch exactly ONE subagent** (Agent tool, general-purpose) and wait for it. Never two at
   once. Prompt (fill in the unit and paths from `markup.py <unit>`):
   > You are the markup worker for unit `<UNIT>` of the active publication-md content repo.
   > Follow `.claude/skills/markup/worker.md` exactly (read it first), and the content repo's
   > `rules/markup.md` (`<CONTENT>/rules/markup.md`). Page files (edit in place, the only copy):
   > `<CONTENT>/<UNIT>-content`; page images: `<WORK>/<UNIT>/pages`; run commands from the publication-md root
   > (`<ROOT>`). Do this one unit only. Reply in ≤ 15 lines as worker.md step 11 says.
3. **Verify** (cheap, here): `markup.py <unit>` shows MARKED (or BLOCKED);
   `npm run validate -- <unit>` → 0 errors; `npm run refs -- --check` → current;
   `npm run refs -- names` → all entity links agree with the names files (a disagreement from an
   earlier unit is fixed with `npm run refs -- names --apply`; a wrong candidate needs a worker).
   If the worker said MARKED but a check fails, or it replied INCOMPLETE (e.g. it ran out of room),
   dispatch ONE more worker for the same unit with its reply as context — it resumes (worker.md,
   "Resuming"). At most two workers per unit; then block it with the reason.
4. **Report** the worker's summary (≤ 15 lines) and your checks, with one `result:` line. Then stop.
   The user commits (pre-commit hook regenerates ref/ and STATS.md) — unless they asked the loop to
   commit each unit; then `git -C <CONTENT> add -A && git -C <CONTENT> commit -m "markup: <UNIT>"`.

## Many units
`/loop /markup Next` — one unit per iteration until the usage limit or the user stops it. A unit
interrupted mid-way stays TODO and the next worker resumes it; a BLOCKED unit is skipped by Next.

The detailed rules for a unit are in `worker.md`; the content-specific ones in the content repo's
`rules/markup.md`.
