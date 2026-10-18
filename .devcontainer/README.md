# The dev container

Two files: `devcontainer.json` and `Dockerfile`. Both are **copies**, owned by this
repository. There is no registry to log into, no dev container features to resolve,
and no `devcontainer-lock.json`.

## First time on a machine

```bash
git clone git@github.com:tvartom/claude-devcontainer.git     # anywhere you like
claude-devcontainer/setup-host.sh     # links ~/claude-shared, then runs doctor.sh
```

Then **Reopen in Container**. No personal access token, no `ssh-agent`, no
`docker login`.

Claude Code asks you to log in the first time: run `/login` once. The login is kept on
this project's own `~/.claude` volume, so it survives rebuilds. Do not use a
`claude setup-token` token instead: it is inference-only, overrides `/login`, and Remote
Control rejects it.

## What comes from where

| | lives in | changes by |
|---|---|---|
| OS tools, shell, node, Claude Code | `Dockerfile`, above the sentinel | `sync-project.sh`, then rebuild |
| this project's system packages | `Dockerfile`, below the sentinel | edit it yourself, then rebuild |
| this project's npm tools | `package.json` | `pnpm install` |
| mounts, env, ports, extensions | `devcontainer.json` | edit, then rebuild |
| Claude Code skills | `~/claude-shared/skills` on the **host** | `git pull` in the kit checkout, then a new session |

## Adding a tool

Three tiers, in order of preference:

1. **An npm package** — `wrangler`, `vite`, `playwright`, `drizzle-kit`, `biome`.
   Put it in `package.json` and run `pnpm install`. Do **not** install it globally in
   the Dockerfile: that silently overrides the version this repo pins, and CI would
   get a different one.
2. **A system package** npm cannot provide — `postgresql-client`, `python3`,
   Playwright's OS libraries. Add it **below the sentinel** in the `Dockerfile` and
   rebuild. The rebuild is fast: everything above the sentinel is byte-identical
   across your repos, so it comes from Docker's layer cache.
3. **A one-off for this container only** — uncomment the `sudoers` line in the
   `Dockerfile`, rebuild once, then `sudo apt-get install …`. Anything installed this
   way is lost on the next rebuild, which is the point; promote it to tier 2 to keep it.

Or just ask Claude — the `devcontainer-kit` skill knows this and will edit the right
file.

## Skills

Every directory in `~/claude-shared/skills` on the host loads automatically as a
`<name>@skills-dir` plugin, user scope, from the first session in a new container.
The mount is read-only, so the agent cannot edit skills that your other projects
also load.

To add or change a skill, edit it under `claude-shared/skills/` in the kit checkout on
the host and start a new session. No rebuild, no install, no `/plugin` command.

## Claude defaults

Remote control at startup, input-needed notifications, `bgIsolation: none` and the
kit status line come from `devcontainer-kit/claude/` in the kit checkout. The
`postStartCommand` merges them into `~/.claude/settings.json` (user scope — the
remote-control keys are ignored in a project's `.claude/settings.json`) on every
start. Keys already in that file win, so `/config` changes stick; editing the kit's
defaults or status line reaches every container at its next start, with no rebuild.

## Capabilities

Nothing here adds Linux capabilities, so the container runs with Docker's defaults —
`NET_ADMIN` is absent and nothing inside can alter iptables, routes, or interfaces.
Egress is unrestricted; the container's job is to isolate the **host filesystem**,
not to police the network. Treat anything readable inside it as exposed, which is why
the Claude login is made per project on this project's own volume rather than shared
from the host.

## Rebuilding

**Dev Containers: Rebuild Container** after any change to the `Dockerfile` or
`devcontainer.json`. Changes to skills, or to anything in `package.json`, do not need
one.
