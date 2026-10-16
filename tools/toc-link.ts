#!/usr/bin/env node
/**
 * Make printed tables of contents clickable: in a table after a contents heading ("Innehåll",
 * "Contents"), each row's title is linked to the unit's part it names —
 * `| [Korallgrottan …](../ref/grottan/1987-1/part/4~1.md) | 4 |`. Only unambiguous matches are
 * linked (title match; among several, the one whose first page is the printed page). A wrong printed
 * page is NOT changed here: `npm run nav` adds the generated correction (spec §3.6).
 *
 *   node tools/toc-link.ts              # dry run
 *   node tools/toc-link.ts --apply
 *   node tools/toc-link.ts 1987_1 -v    # one unit, list every row
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseBlocks, parseFrontmatter } from '../lib/src/index.ts'
import { findUnits, readUnit, workspaceFromArgs } from './units.ts'

const args = process.argv.slice(2)
const ws = workspaceFromArgs(args)
const apply = args.includes('--apply')
const verbose = args.includes('-v')
const tokens = args.filter((a) => !a.startsWith('-'))
const ns = Object.entries(ws.config.refs ?? {}).find(([, v]) => v?.units)?.[0]
if (!ns) {
	console.error('no units namespace in refs: — nothing to link to')
	process.exit(1)
}

const RE_HEADING = /^#{1,6}\s*(innehåll|innehållsförteckning|contents|table of contents)\b/i
const RE_PAGE_CELL = /^\s*(\d+|[ivxlcdm]+)\s*(?:[-–—]\s*\S+)?\s*$/i
const words = (s: string) =>
	s
		.normalize('NFC')
		.toLowerCase()
		.replace(/[*_`"”“'’:;,.!?()[\]—–-]+/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length > 1)
const similar = (a: string, b: string) => {
	const A = new Set(words(a))
	const B = new Set(words(b))
	if (!A.size || !B.size) return 0
	let n = 0
	for (const w of A) if (B.has(w)) n++
	return n / Math.min(A.size, B.size)
}

let linked = 0
let unmatched = 0
let files = 0
for (const folder of findUnits(ws, tokens)) {
	const unit = readUnit(ws, folder)
	if (unit.publication === undefined) continue
	const id = (parseFrontmatter(unit.publication)?.data as Record<string, unknown> | undefined)?.id
	if (typeof id !== 'string') continue
	const local = id.replace(/^[^-]+-/, '')
	const parts: { rest: string; title: string; first: string }[] = []
	for (const p of unit.pages)
		for (const b of parseBlocks(p.text, p.name)) {
			if (b.kind !== 'part' || typeof b.value !== 'object' || b.value === null) continue
			const v = b.value as Record<string, unknown>
			if (v.continued === true || typeof v.key !== 'string') continue
			parts.push({
				rest: v.key.slice(v.key.indexOf('|') + 1).replace(/\|/g, '~'),
				title: `${String(v.title ?? '')} ${String(v.subtitle ?? '')}`,
				first: String(v.pages ?? '').split(/\s*[-–,]\s*/)[0]?.trim() ?? '',
			})
		}
	if (!parts.length) continue
	const report: string[] = []
	for (const p of unit.pages) {
		const lines = p.text.split('\n')
		let inToc = false
		let changed = false
		for (const [i, line] of lines.entries()) {
			if (/^#{1,6}\s/.test(line)) inToc = RE_HEADING.test(line)
			if (!inToc || !line.trimStart().startsWith('|') || /^\s*\|[\s:|-]+\|\s*$/.test(line)) continue
			const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/)
			const ti = cells.findIndex((c) => /\p{L}{3,}/u.test(c))
			const cell = cells[ti] ?? ''
			if (ti < 0 || /\]\(/.test(cell)) continue
			const page = [...cells].reverse().find((c) => RE_PAGE_CELL.test(c))
			const printed = page ? (RE_PAGE_CELL.exec(page)?.[1] ?? '') : ''
			let cands = parts.filter((x) => similar(cell, x.title) >= 0.6)
			if (cands.length > 1) {
				const best = Math.max(...cands.map((x) => similar(cell, x.title)))
				cands = cands.filter((x) => similar(cell, x.title) === best)
			}
			if (cands.length > 1 && printed) {
				const onPage = cands.filter((x) => x.first.toLowerCase() === printed.toLowerCase())
				if (onPage.length) cands = onPage
			}
			const text = cell.trim()
			if (cands.length !== 1 || !cands[0]) {
				unmatched++
				report.push(`  ? ${p.name}:${i + 1} "${text}" (${cands.length} candidates)`)
				continue
			}
			cells[ti] = cell.replace(text, `[${text}](../ref/${ns}/${local}/part/${cands[0].rest}.md)`)
			lines[i] = `|${cells.join('|')}|`
			changed = true
			linked++
			if (verbose) report.push(`  + "${text}" → ${cands[0].rest}`)
			if (args.includes('--mismatch') && printed && printed.toLowerCase() !== cands[0].first.toLowerCase()) report.push(`  ≠ "${text}" printed ${printed} → part ${cands[0].rest}`)
		}
		if (changed) {
			files++
			if (apply) writeFileSync(join(resolve(ws.contentRoot, folder), p.name), lines.join('\n'))
		}
	}
	if (report.length) console.log(`${folder}\n${report.join('\n')}`)
}
console.log(`\n${linked} row(s) linked, ${unmatched} left unlinked, ${files} file(s) ${apply ? 'written' : 'would change'}`)
