#!/usr/bin/env node
/**
 * Bring the part blocks (and unit metadata) in line with the content repo's table-of-contents
 * snapshot — for Grottan `data/toc-sheet.yaml` (`issues:` + `toc:`, the Google Sheet's columns).
 *
 *   node tools/toc-sync.ts               # dry run: what differs, per unit
 *   node tools/toc-sync.ts --apply       # apply the mechanical changes
 *   node tools/toc-sync.ts 2017-2        # selected units
 *
 * Mechanical (applied):
 *   - a part whose sheet row changed its pages: new `pages`, new key (`<issue>|<pages>|<n>`), the
 *     key renamed in its `continued` blocks and in every `…/part/<pages>~<n>.md` link and
 *     `subjects:` entry across the corpus; printed pages dropped from the END of a part (e.g. a
 *     picture-only back cover) get a `<!-- part: none -->` where they start;
 *   - a changed title;
 *   - `pageSequence` from `issues:` when it differs and the result still validates.
 * Structural (listed only — someone must read the page): sheet rows with no part block, part
 * blocks with no sheet row, author differences.
 *
 * The sheet mapping (column names, key rule) is the one in the content repo's rules/markup.md.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PageSequence } from '@tvartom/pagesequence'
import { parse as parseYaml } from 'yaml'
import { parseBlocks, parseFrontmatter, validateUnit } from '../lib/src/index.ts'
import { findUnits, readUnit, workspaceFromArgs } from './units.ts'

const args = process.argv.slice(2)
const ws = workspaceFromArgs(args)
const apply = args.includes('--apply')
const tokens = args.filter((a) => !a.startsWith('--'))
const SHEET = join(ws.contentRoot, 'data', 'toc-sheet.yaml')
if (!existsSync(SHEET)) {
	console.error(`no ${SHEET}`)
	process.exit(1)
}
type Row = Record<string, string>
const sheet = parseYaml(readFileSync(SHEET, 'utf8')) as { issues: Row[]; toc: Row[] }

const issueKey = (n: string) => n.replace(/\s*\(\d{4}\)\s*$/, '').trim()
const norm = (s: string) => s.replace(/\\"/g, '"').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Expected parts per issue key, in sheet order, with the `<n>` of the key rule. */
const expected = new Map<string, { key: string; title: string; pages: string; authors: string }[]>()
for (const r of sheet.toc) {
	const issue = issueKey(r.Nummerbeteckning ?? '')
	const pages = String(r['Sid(or)'] ?? '').replace(/\s+/g, '')
	if (!issue || !pages) continue
	const list = expected.get(issue) ?? []
	const n = list.filter((p) => p.pages === pages).length + 1
	list.push({ key: `${issue}|${pages}|${n}`, title: String(r.Titel ?? '').replace(/\s*\n\s*/g, ' '), pages, authors: String(r['Författare, roll'] ?? '') })
	expected.set(issue, list)
}
const issueRows = new Map(sheet.issues.map((r) => [issueKey(r.Nummerbeteckning ?? ''), r]))

// The committed snapshot: a title is only taken over when the sheet's title CHANGED since then (a
// correction); other title differences are listed (the sheet itself has typos, e.g. "Pa gang").
const committed = spawnSync('git', ['-C', ws.contentRoot, 'show', 'HEAD:data/toc-sheet.yaml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const oldTitles = new Set(
	committed.status === 0
		? ((parseYaml(committed.stdout) as { toc?: Row[] }).toc ?? []).map((r) => `${issueKey(r.Nummerbeteckning ?? '')}\u0000${String(r.Titel ?? '').replace(/\s*\n\s*/g, ' ')}`)
		: [],
)
const samePages = (a: string, b: string) => a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase()

interface Part { key: string; title: string; pages: string; file: string; line: number }
interface Rename { unit: string; local: string; from: string; to: string }

const renames: Rename[] = []
const edits = new Map<string, string>() // absolute path → new text (pages + publication.md)
const read = (p: string) => edits.get(p) ?? readFileSync(p, 'utf8')
let structural = 0
let mechanical = 0

for (const folder of findUnits(ws, tokens)) {
	const unit = readUnit(ws, folder)
	const dir = resolve(ws.contentRoot, folder)
	if (unit.publication === undefined) continue
	const fm = parseFrontmatter(unit.publication)
	const d = isObj(fm?.data) ? fm.data : {}
	const id = typeof d.id === 'string' ? d.id : ''
	const local = id.replace(/^[^-]+-/, '')
	const want = expected.get(local) ?? []
	const parts: Part[] = []
	for (const p of unit.pages) {
		for (const b of parseBlocks(p.text, p.name)) {
			if (b.kind !== 'part' || !isObj(b.value) || b.value.continued === true || typeof b.value.key !== 'string') continue
			parts.push({ key: b.value.key, title: String(b.value.title ?? ''), pages: String(b.value.pages ?? ''), file: p.name, line: b.loc.line })
		}
	}
	const out: string[] = []
	const free = new Set(parts.map((_, i) => i))
	const pairs: [Part, (typeof want)[number]][] = []
	// 1) same key and title  2) same title  3) same key
	for (const pass of [0, 1, 2]) {
		for (const w of want) {
			if (pairs.some(([, x]) => x === w)) continue
			const i = [...free].find((i) => {
				const p = parts[i]
				if (!p) return false
				if (pass === 0) return p.key === w.key && norm(p.title) === norm(w.title)
				if (pass === 1) return norm(p.title) === norm(w.title)
				return p.key === w.key
			})
			if (i === undefined) continue
			free.delete(i)
			const p = parts[i]
			if (p) pairs.push([p, w])
		}
	}
	for (const [p, w] of pairs) {
		const file = join(dir, p.file)
		const seqText = typeof d.pageSequence === 'string' ? d.pageSequence : null
		const seq = seqText ? PageSequence.create(seqText) : null
		const keyMoved = p.key.toLowerCase() !== w.key.toLowerCase()
		if (!samePages(p.pages, w.pages) && seq && !seq.getIndexList(w.pages)) {
			out.push(`  ! sheet pages "${w.pages}" not in pageSequence — not applied: ${p.key} "${w.title}"`)
			structural++
		} else if (keyMoved || !samePages(p.pages, w.pages)) {
			out.push(`  pages ${p.key} → ${w.key}  "${w.title}"`)
			mechanical++
			if (p.key !== w.key) renames.push({ unit: id, local, from: p.key, to: w.key })
			// update the block's pages (keep the sheet's spelling)
			const lines = read(file).split('\n')
			const l = lines[p.line - 1] ?? ''
			lines[p.line - 1] = l.replace(/pages: ("[^"]*"|[^,}]+)/, `pages: "${w.pages}"`)
			edits.set(file, lines.join('\n'))
			// printed pages dropped from the end → part: none where the first of them starts
			const before = seq?.getLabelList(p.pages.replace(/\s/g, '')) ?? []
			const after = new Set((seq?.getLabelList(w.pages) ?? []).map((x) => x.toLowerCase()))
			const dropped = before.filter((x) => !after.has(x.toLowerCase()))
			const tail = before.slice(before.length - dropped.length)
			if (dropped.length && dropped.every((x, k) => x === tail[k])) {
				const first = dropped[0] ?? ''
				const idx = seq?.getIndexList(first)?.[0]
				if (idx !== undefined) {
					const pf = join(dir, `pageIndex-${String(idx).padStart(3, '0')}.md`)
					let t = read(pf)
					if (!/<!-- part: none -->/.test(t)) {
						const marker = new RegExp(`<!-- page: ${first} -->\\n?`)
						t = marker.test(t) ? t.replace(marker, (m) => `${m.endsWith('\n') ? m : `${m}\n`}<!-- part: none -->\n`) : `<!-- part: none -->\n${t}`
						edits.set(pf, t)
						out.push(`    + part: none on p. ${first} (${dropped.join(', ')} no longer in the part)`)
					}
				}
			}
		}
		if (norm(p.title) !== norm(w.title) && oldTitles.has(`${local}\u0000${w.title}`)) {
			out.push(`  ? title differs (sheet unchanged, not applied) ${w.key}: "${p.title}" vs sheet "${w.title}"`)
		} else if (norm(p.title) !== norm(w.title)) {
			out.push(`  title ${w.key}: "${p.title}" → "${w.title}"`)
			mechanical++
			const lines = read(join(dir, p.file)).split('\n')
			lines[p.line - 1] = (lines[p.line - 1] ?? '').replace(/title: ("(?:[^"\\]|\\.)*"|[^,}]+)/, `title: ${JSON.stringify(w.title)}`)
			edits.set(join(dir, p.file), lines.join('\n'))
		}
	}
	for (const w of want) if (!pairs.some(([, x]) => x === w)) { out.push(`  ! sheet row without part block: ${w.key} "${w.title}"`); structural++ }
	for (const i of free) {
		const p = parts[i]
		if (p) { out.push(`  ! part block without sheet row: ${p.key} "${p.title}" (${p.file})`); structural++ }
	}
	// pageSequence
	const row = issueRows.get(local)
	const sheetSeq = row?.['Sidbenämningsföljd (PDF)']?.trim()
	if (sheetSeq && sheetSeq !== d.pageSequence) {
		const pubPath = join(dir, 'publication.md')
		const pub = read(pubPath)
		const next = /^pageSequence:.*$/m.test(pub)
			? pub.replace(/^pageSequence:.*$/m, `pageSequence: ${JSON.stringify(sheetSeq)}`)
			: pub.replace(/^source:/m, `pageSequence: ${JSON.stringify(sheetSeq)}\nsource:`)
		const ok = !validateUnit({ name: folder, publication: next, pages: unit.pages }).some((x) => x.message.startsWith('pageSequence'))
		out.push(`  pageSequence ${JSON.stringify(d.pageSequence ?? null)} → ${JSON.stringify(sheetSeq)}${ok ? '' : '  (NOT applied: does not fit the page files)'}`)
		if (ok) { edits.set(pubPath, next); mechanical++ } else structural++
	}
	if (out.length) console.log(`${folder}\n${out.join('\n')}`)
}

// Key renames: the part's own block, its `continued` blocks, links and subjects, corpus-wide.
if (renames.length) {
	const tmp = (r: Rename) => `\u0000${r.from}\u0000`
	const restOf = (key: string) => key.slice(key.indexOf('|') + 1).replace(/\|/g, '~')
	for (const folder of findUnits(ws, [])) {
		const dir = resolve(ws.contentRoot, folder)
		for (const p of readUnit(ws, folder).pages) {
			const file = join(dir, p.name)
			let t = read(file)
			const orig = t
			for (const r of renames) {
				t = t.split(`key: "${r.from}"`).join(`key: "${tmp(r)}"`)
				t = t.split(`/${r.local}/part/${restOf(r.from)}.md`).join(`/${r.local}/part/${tmp(r)}.md`)
				t = t.split(`grottan/${r.local}/part/${restOf(r.from)}`).join(`grottan/${r.local}/part/${tmp(r)}`)
			}
			for (const r of renames) {
				t = t.split(`key: "${tmp(r)}"`).join(`key: "${r.to}"`)
				t = t.split(`/${r.local}/part/${tmp(r)}.md`).join(`/${r.local}/part/${restOf(r.to)}.md`)
				t = t.split(`grottan/${r.local}/part/${tmp(r)}`).join(`grottan/${r.local}/part/${restOf(r.to)}`)
			}
			if (t !== orig) edits.set(file, t)
		}
	}
}

console.log(`\n${mechanical} mechanical change(s), ${renames.length} key rename(s), ${structural} structural item(s) to review; ${edits.size} file(s) ${apply ? 'written' : 'would change'}`)
if (apply) for (const [p, t] of edits) writeFileSync(p, t)
else if (edits.size) console.log('dry run — re-run with --apply')
