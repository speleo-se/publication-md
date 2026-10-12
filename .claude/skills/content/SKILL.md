---
name: content
description: Manage the content repos of this publication-md workspace — create a new one (fully set up), add one (clone a git URL or link a local checkout), list them, switch the active one, fetch a unit's source PDF, or show which repo/paths the tools act on. Use when the user says "add repo …", "use <name>", "which content is active", "fetch the PDF for …", or wants to start working on a content repo.
---

# /content — the content repos of this workspace

publication-md holds the tools; **content repos** hold the transcriptions (one per periodical,
book series, archive …). They live under `content/<name>` (clone or symlink, gitignored), their
render trees under `work/<name>`, and one is **active** — every tool and skill acts on it.

Always show the user the command you run.

## Add a content repo

```bash
npm run content -- add <git-url>              # clones into content/<name>
npm run content -- add /path/to/checkout      # links an existing checkout
npm run content -- add <url-or-path> --name <name>
```

`add` checks the repo's `publication-md.yaml` (spec/content-repo.md), makes it active and prints
its owner, copyright and licence — **tell the user these**; much content is not freely
redistributable.

Known repos are listed in `registry.yaml` — offer them when the user asks what exists. Some are
private; access is granted by their owner, not by publication-md.

## Create a new content repo

Ask the user for: the short **name** (`[a-z0-9._-]`, also the reference namespace), the
**title**, the **owner** (who holds the copyright), the **language** of the content (BCP 47,
e.g. `sv`), and where the new repo should live (a directory outside publication-md). Then:

```bash
npm run content -- init <dir> --name <name> --title "<title>" --owner "<owner>" --language <lang> [--license "<terms>"]
```

It writes publication-md.yaml, README, .gitignore, rules/transcribe.md (a stub to fill in),
people.yaml, collections/<name>.yaml, the GitHub Action caller and VS Code settings; runs
`git init`; and links it as the active repo. Then help the user adjust `units.glob`/`patterns`
to their file naming, add `sources`, fill in `rules/transcribe.md`, create the GitHub repo and
push (they commit — show the commands), and optionally add it to `registry.yaml`.

## Then, before transcribing

1. `npm run validate` — the repo must validate (known legacy errors are fine; report them).
2. **Read the repo's rules folder** (`rules:` in its publication-md.yaml, default `rules/`).
   The `transcribe` skill requires it; summarise to the user what is content-specific.
3. Source PDFs are gitignored: `npm run fetch -- <unit>` downloads one per the repo's `sources`.
   For Google Drive sources the user logs in once with their own Google account:
   `npm run fetch -- login` (interactive — ask the user to run it with `! npm run fetch -- login`;
   they open the printed address, log in, and paste the final address back if the redirect page
   does not load). "Folder not found" means the Drive folder is not shared with that account.
   If the repo has no `google:` client yet, the owner must create one once (spec/content-repo.md,
   "Google Drive login") — the gdrive CLI fallback needs a personal Google Cloud client.

## Other commands

```bash
npm run content -- list            # * marks the active repo
npm run content -- use <name>      # switch
npm run content -- remove <name>   # unlinks a symlink; a clone is left for the user to delete
node tools/workspace.ts            # active repo + its content/work paths
PMD_CONTENT=<name> <command>       # act on another repo for one command
```

`add` and `init` install git hooks in the content repo: pre-commit regenerates `ref/` and
`STATS.md` into each commit, pre-push validates (a failure blocks the push — fix it rather than
reaching for `--no-verify`). `npm run content -- hooks install <name>` re-installs them, e.g.
after publication-md has moved.

## Upgrading a content repo to a new publication-md version

When validation, `content add` or the pre-push hook says *"content is publication-md-content 0.1,
these tools are 0.2 — run: npm run content -- upgrade"*, the repo needs migrating. It is a
deterministic tool, not a judgement call:

```bash
npm run content -- upgrade <name> --check   # is an upgrade due? (exit 1 = yes)
npm run content -- upgrade <name>           # migrate, regenerate ref/ + STATS.md, validate
```

It refuses to run with uncommitted changes (so the upgrade is one reviewable diff). Show the user
the summary and `git diff --stat`, and let them commit. "Newer than these tools" means the user
should update publication-md (`git pull`), not the content.

Never delete a cloned content repo yourself — it may hold unpushed work.
