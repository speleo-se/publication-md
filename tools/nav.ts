#!/usr/bin/env node
/**
 * Navigation lines: previous/next page links in every deliverable page file, and a table of
 * contents at the end of each publication.md, for proof-reading on GitHub (spec §3.6). Generated,
 * not content — consumers drop them (`stripNav`, `stripToc`).
 *
 *   node tools/nav.ts                 # every *-content folder
 *   node tools/nav.ts 1987_2          # selected units (name or unique substring)
 *   node tools/nav.ts --check         # exit 1 if any page's line is missing or stale (CI, pre-push)
 *
 * Position from `nav.position` in publication-md.yaml (bottom | top | both | none; default
 * bottom).
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findUnits, navPosition, navUpdates, readUnit, workspaceFromArgs } from './units.ts'

const args = process.argv.slice(2)
const ws = workspaceFromArgs(args)
const check = args.includes('--check')
const tokens = args.filter((a) => !a.startsWith('--'))

let files = 0
let units = 0
for (const name of findUnits(ws, tokens)) {
	const updates = navUpdates(ws, readUnit(ws, name))
	if (!updates.size) continue
	units++
	files += updates.size
	if (check) {
		for (const f of updates.keys()) console.log(`stale ${name}/${f}`)
		continue
	}
	const dir = resolve(ws.contentRoot, name)
	for (const [f, text] of updates) writeFileSync(join(dir, f), text)
}
const where = navPosition(ws)
if (check) {
	console.log(files ? `${files} file(s) in ${units} unit(s) need \`npm run nav\`` : `navigation lines and contents current (${where})`)
	process.exit(files ? 1 : 0)
}
console.log(`navigation (${where}) and contents: updated ${files} file(s) in ${units} unit(s)`)
