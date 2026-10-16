/**
 * `npm run refs -- names [--apply] [--content <name>]` — check reference links against the names
 * files of the entity namespaces (`refs.<ns>.names` in publication-md.yaml), so a printed name is
 * linked the same way in every unit.
 *
 *   check (default)  list links whose target disagrees with the names file, and linked names that
 *                    are not in it yet; exit 1 on any disagreement
 *   --apply          rewrite the targets of fixed-id disagreements (link text untouched) in the
 *                    page files (the deliverable — the only copy of the text)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { applyNames, checkNames, type NameMismatch, parseNames, type RefNamespaces } from '../lib/src/index.ts'
import type { Workspace } from './workspace.ts'

export function runNames(ws: Workspace, argv: string[]): number {
	const apply = argv.includes('--apply')
	const refs = Object.entries(ws.config.refs ?? {})
	const NS: RefNamespaces = {
		units: new Set(refs.filter(([, v]) => v?.units).map(([k]) => k)),
		entities: new Set(refs.filter(([, v]) => !v?.units).map(([k]) => k)),
	}
	const withNames = refs.filter(([, v]) => v?.names)
	if (!withNames.length) {
		console.log('no namespace declares a names file (refs.<ns>.names) — nothing to check')
		return 0
	}
	let bad = 0
	for (const [ns, v] of withNames) {
		const file = join(ws.contentRoot, String(v?.names))
		if (!existsSync(file)) {
			console.error(`${ns}: names file ${v?.names} not found`)
			bad++
			continue
		}
		const { index, problems } = parseNames(readFileSync(file, 'utf8'), String(v?.names))
		for (const p of problems) console.error(`ERROR ${p.file}: ${p.message}`)
		bad += problems.length
		const unlisted = new Map<string, number>()
		let fixed = 0
		for (const unit of readdirSync(ws.contentRoot).filter((d) => d.endsWith('-content')).sort()) {
			const dir = join(ws.contentRoot, unit)
			for (const page of readdirSync(dir).filter((f) => /^pageIndex-\d+\.md$/.test(f)).sort()) {
				const text = readFileSync(join(dir, page), 'utf8')
				const { mismatches, unlisted: un } = checkNames(text, `${unit}/${page}`, ns, index, NS)
				for (const n of un) unlisted.set(n, (unlisted.get(n) ?? 0) + 1)
				if (!mismatches.length) continue
				for (const m of mismatches) print(m)
				const fixable = mismatches.filter((m) => m.expected !== undefined)
				bad += mismatches.length - (apply ? fixable.length : 0)
				if (apply && fixable.length) {
					const out = applyNames(text, fixable)
					writeFileSync(join(dir, page), out)
					fixed += fixable.length
				}
			}
		}
		if (unlisted.size) {
			console.log(`\n${ns}: ${unlisted.size} linked name(s) not in ${v?.names} — add them:`)
			for (const [n, c] of [...unlisted].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${n} (${c})`)
			if (unlisted.size > 40) console.log(`  … and ${unlisted.size - 40} more`)
		}
		if (apply) console.log(`\n${ns}: fixed ${fixed} link(s)`)
	}
	console.log(bad ? `\n${bad} disagreement(s) with the names files` : '\nall entity links agree with the names files')
	return bad ? 1 : 0
}

function print(m: NameMismatch) {
	const want = m.expected ?? `one of ${m.candidates?.join(', ')} (decide from context)`
	console.log(`${m.file}:${m.line}: [${m.text}] → ${m.current}, names file says ${want}`)
}

/**
 * A review worksheet per names file: every entry that still needs a human decision (`review:`)
 * and every ambiguous entry (`candidates`) with unresolved mentions — with the register's facts,
 * links to the authority's pages and to every mention's page file. Generated into ref/ by
 * `npm run refs` (kept current by the pre-commit hook). Paths are relative to ref/.
 */
export function reviewFiles(ws: Workspace): Map<string, string> {
	const out = new Map<string, string>()
	const SV = ws.config.language === 'sv'
	const key = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
	for (const [ns, v] of Object.entries(ws.config.refs ?? {})) {
		if (!v?.names || !existsSync(join(ws.contentRoot, v.names))) continue
		const { entries } = parseNames(readFileSync(join(ws.contentRoot, v.names), 'utf8'))
		const raw = parseYaml(readFileSync(join(ws.contentRoot, v.names), 'utf8')) as Record<string, unknown>[]
		// Optional register: a YAML list whose items have `id` or `riksnr`, plus descriptive fields.
		const reg = new Map<string, Record<string, unknown>>()
		if (v.register && existsSync(join(ws.contentRoot, v.register))) {
			for (const r of parseYaml(readFileSync(join(ws.contentRoot, v.register), 'utf8')) as Record<string, unknown>[]) {
				reg.set(String(r.id ?? r.riksnr), r)
			}
		}
		// Mentions per entry (by printed form), and whether they are resolved.
		const formIdx = new Map<string, number>()
		entries.forEach((e, i) => e.printed.forEach((p) => formIdx.set(key(p), i)))
		const mentions: { unit: string; page: string; line: number; text: string; target: string; ctx: string }[][] = entries.map(() => [])
		for (const unit of readdirSync(ws.contentRoot).filter((d) => d.endsWith('-content')).sort()) {
			for (const page of readdirSync(join(ws.contentRoot, unit)).filter((f) => /^pageIndex-\d+\.md$/.test(f)).sort()) {
				readFileSync(join(ws.contentRoot, unit, page), 'utf8').split('\n').forEach((line, i) => {
					for (const m of line.matchAll(new RegExp(`\\[([^\\]]+)\\]\\(\\.\\./ref/${ns}/([^)]+)\\.md\\)`, 'g'))) {
						const j = formIdx.get(key(m[1] ?? ''))
						if (j === undefined) continue
						const s = Math.max(0, (m.index ?? 0) - 160)
						const ctx = line.slice(s, (m.index ?? 0) + m[0].length + 120).replace(/\]\([^)]*\)/g, ']').replace(/<!--.*?-->/g, '').trim()
						mentions[j]?.push({ unit, page, line: i + 1, text: m[1] ?? '', target: m[2] ?? '', ctx })
					}
				})
			}
		}
		const facts = (id: string) => {
			const r = reg.get(id)
			if (!r) return `\`${id}\``
			const place = ['socken', 'kommun', 'landskap'].map((k) => r[k]).filter(Boolean).join(', ')
			const also = Array.isArray(r.also) ? ` — ${SV ? 'även' : 'also'}: ${(r.also as string[]).join(', ')}` : ''
			const url = v.pageUrl && r.path ? v.pageUrl.replace('{path}', String(r.path)) : null
			return `${url ? `[${id} ${r.name}](${url})` : `${id} ${r.name}`} (${place})${also}`
		}
		const work = entries
			.map((e, i) => ({ e, i, raw: raw[i] ?? {}, ms: mentions[i] ?? [] }))
			.filter(({ raw: r, e, ms }) => r.review || (e.candidates && ms.some((m) => m.target === 'unknown')))
		const T = SV
			? { title: `Granskning: ${v.title ?? ns}`, intro: 'Genererad av `npm run refs` ur', how: 'Så avslutar du en post: ändra den i namnfilen (`id`, eller `candidates` + `hint`), ta bort raden `review:`, kör `npm run refs -- names --apply` (rättar länkar med fast id) och sedan `npm run refs`. Länkar som ska skilja sig per förekomst ändras direkt i sidfilen.', now: 'Nu', why: 'Varför', reg: 'Registret', ment: 'Förekomster', open: 'olöst', todo: 'att granska', amb: 'tvetydiga namn med olösta förekomster' }
			: { title: `Review: ${v.title ?? ns}`, intro: 'Generated by `npm run refs` from', how: 'To close an entry: edit it in the names file (`id`, or `candidates` + `hint`), delete its `review:` line, run `npm run refs -- names --apply` (fixes links with a fixed id), then `npm run refs`. Links that must differ per mention are changed in the page file directly.', now: 'Now', why: 'Why', reg: 'Register', ment: 'Mentions', open: 'unresolved', todo: 'to review', amb: 'ambiguous names with unresolved mentions' }
		// GitHub heading anchors: lower case, drop punctuation, spaces → hyphens.
		const anchor = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-')
		const nReview = work.filter((w) => w.raw.review).length
		const lines = [
			'<!-- generated by publication-md tools/refs.ts — do not edit; regenerate with: npm run refs -->',
			'',
			`# ${T.title}`,
			'',
			`${T.intro} [\`${v.names}\`](../${v.names}). **${nReview}** ${T.todo}, **${work.length - nReview}** ${T.amb}.`,
			'',
			`> ${T.how}`,
			'',
			...work.map(({ e }) => `- [${e.printed[0] ?? ''}](#${anchor(e.printed[0] ?? '')})`),
		]
		for (const { e, raw: r, ms } of work) {
			const now = e.id !== undefined ? (e.id === 'unknown' ? 'unknown' : facts(e.id)) : `${SV ? 'kandidater' : 'candidates'}: ${e.candidates?.join(', ')}`
			lines.push('', `## ${e.printed[0]}`, '')
			if (e.printed.length > 1) lines.push(`${SV ? 'Skrivs även' : 'Also printed'}: ${e.printed.slice(1).join(', ')}`, '')
			lines.push(`- **${T.now}:** ${now}`)
			if (r.review) lines.push(`- **${T.why}:** ${String(r.review)}`)
			if (e.note) lines.push(`- ${e.note}`)
			if (e.hint) lines.push(`- ${SV ? 'Ledtråd' : 'Hint'}: ${e.hint}`)
			const ids = [...new Set([...(e.id && e.id !== 'unknown' ? [e.id] : []), ...(e.candidates ?? [])])]
			if (ids.length) lines.push(`- **${T.reg}:**`, ...ids.map((id) => `  - ${facts(id)}`))
			lines.push(`- **${T.ment}** (${ms.length}):`)
			for (const m of ms) {
				const where = `${m.unit.replace(/-content$/, '')} ${m.page}:${m.line}`
				lines.push(`  - [${where}](../${m.unit}/${m.page}) → \`${m.target}\`${m.target === 'unknown' ? ` (${T.open})` : ''} — …${m.ctx}…`)
			}
		}
		out.set(`ref/review-${ns}.md`, `${lines.join('\n')}\n`)
	}
	return out
}
