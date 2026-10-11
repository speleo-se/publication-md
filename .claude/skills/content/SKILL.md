---
name: content
description: Manage the content repos of this publication-md workspace — add one (clone a git URL or link a local checkout), list them, switch the active one, fetch a unit's source PDF, or show which repo/paths the tools act on. Use when the user says "add repo …", "use <name>", "which content is active", "fetch the PDF for …", or wants to start working on a content repo.
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
redistributable. If it prints firewall domains, the devcontainer needs them: add them to
`.devcontainer/init-firewall.sh` and ask the user to rebuild (you cannot change the firewall
yourself).

Known repos are listed in `registry.yaml` — offer them when the user asks what exists. Some are
private; access is granted by their owner, not by publication-md.

## Then, before transcribing

1. `npm run validate` — the repo must validate (known legacy errors are fine; report them).
2. **Read the repo's rules folder** (`rules:` in its publication-md.yaml, default `rules/`).
   The `transcribe` skill requires it; summarise to the user what is content-specific.
3. Source PDFs are gitignored: `npm run fetch -- <unit>` downloads one per the repo's `sources`
   (gdrive sources need the `gdrive` CLI authenticated once: `gdrive account add`).

## Other commands

```bash
npm run content -- list            # * marks the active repo
npm run content -- use <name>      # switch
npm run content -- remove <name>   # unlinks a symlink; a clone is left for the user to delete
node tools/workspace.ts            # active repo + its content/work paths
PMD_CONTENT=<name> <command>       # act on another repo for one command
```

Never delete a cloned content repo yourself — it may hold unpushed work.
