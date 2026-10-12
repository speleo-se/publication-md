#!/bin/sh
# Default Claude Code user settings for this devcontainer (runs on container create).
# Only ADDS keys that are missing from ~/.claude/settings.json — never overwrites a choice made
# later with /config.
#   remoteControlAtStartup   sessions can be followed/steered from claude.ai and the mobile app
#                            (useful for long /loop runs like `/loop /markup Next`)
#   inputNeededNotifEnabled  notify when a session waits for input (e.g. a permission prompt)
set -e
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$dir"
node -e '
const fs = require("fs")
const f = process.argv[1]
let s = {}
try { s = JSON.parse(fs.readFileSync(f, "utf8")) } catch {}
const defaults = { remoteControlAtStartup: true, inputNeededNotifEnabled: true }
let added = []
for (const [k, v] of Object.entries(defaults)) if (!(k in s)) { s[k] = v; added.push(k) }
fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n")
console.log(added.length ? `claude-defaults: added ${added.join(", ")} to ${f}` : "claude-defaults: settings already present")
' "$dir/settings.json"
