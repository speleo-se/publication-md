import { PageSequence } from '@tvartom/pagesequence'
import { parse as parseYaml } from 'yaml'
import { parseBlocks, parseFrontmatter } from './parse.ts'
import { versionMessage } from './contentConfig.ts'
import { FORMAT, type Person, type Problem } from './types.ts'

/** One unit folder as read from disk (or R2): `publication.md` + `pageIndex-NNN.md` files. */
export interface UnitInput {
	/** Folder name, used in messages. */
	name: string
	/** Raw text of `publication.md`, if the unit has one. */
	publication?: string
	pages: { name: string; text: string }[]
}

export interface Context {
	/** From `people.yaml` (see `parsePeople`); empty disables the people check. */
	people?: PeopleIndex
	/** Known `collections/<id>.yaml` ids; undefined disables the container check. */
	collections?: Set<string>
}

/** lower-cased name or alias → canonical name */
export type PeopleIndex = Map<string, string>

/** `people.yaml`: a list of `{ name, aliases?, ... }`. */
export function parsePeople(text: string): { index: PeopleIndex; problems: Problem[] } {
	const index: PeopleIndex = new Map()
	const problems: Problem[] = []
	const data: unknown = parseYaml(text) ?? []
	if (!Array.isArray(data)) {
		problems.push({ level: 'error', file: 'people.yaml', message: 'must be a list of people' })
		return { index, problems }
	}
	for (const [i, p] of data.entries()) {
		if (!isObj(p) || typeof p.name !== 'string' || !p.name.trim()) {
			problems.push({ level: 'error', file: 'people.yaml', message: `entry ${i}: needs a name` })
			continue
		}
		const names = [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])]
		for (const n of names) {
			if (typeof n !== 'string') continue
			const k = n.trim().toLowerCase()
			const prev = index.get(k)
			if (prev && prev !== p.name) {
				problems.push({
					level: 'error',
					file: 'people.yaml',
					message: `"${n}" maps to both "${prev}" and "${p.name}"`,
				})
			}
			index.set(k, p.name)
		}
	}
	return { index, problems }
}

/** A person may be written as a bare string (`Anna Svensson`) or `{ name, role }`. */
export function normalizePerson(v: unknown): Person | null {
	if (typeof v === 'string' && v.trim()) return { name: v.trim() }
	if (isObj(v) && typeof v.name === 'string' && v.name.trim()) {
		return typeof v.role === 'string'
			? { name: v.name.trim(), role: v.role }
			: { name: v.name.trim() }
	}
	return null
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v)

const RE_ID = /^[A-Za-z0-9][A-Za-z0-9._|:-]*$/
const RE_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/

const PUBLICATION_KEYS = new Set([
	'format',
	'id',
	'type',
	'title',
	'authors',
	'editors',
	'issued',
	'publisher',
	'language',
	'identifiers',
	'rights',
	'container',
	'volume',
	'issue',
	'source',
	'pageSequence',
])
const PART_KEYS = new Set([
	'key',
	'type',
	'genre',
	'title',
	'subtitle',
	'authors',
	'rights',
	'pages',
	'subjects',
])
const FIGURE_KEYS = new Set(['key', 'kind', 'caption', 'creators', 'license', 'subjects'])
const NOTE_TYPES = new Set(['transcription', 'editorial'])

/**
 * Validate one unit. Pure: no I/O, runs unchanged in Node and workerd.
 * Unknown keys are warnings (catches typos) unless prefixed `x-` (local extensions).
 */
export function validateUnit(unit: UnitInput, ctx: Context = {}): Problem[] {
	const out: Problem[] = []
	const err = (file: string, line: number | undefined, message: string) =>
		out.push(
			line === undefined ? { level: 'error', file, message } : { level: 'error', file, line, message },
		)
	const warn = (file: string, line: number | undefined, message: string) =>
		out.push(
			line === undefined
				? { level: 'warning', file, message }
				: { level: 'warning', file, line, message },
		)

	const people = (file: string, line: number | undefined, field: string, v: unknown) => {
		if (v === undefined) return
		if (!Array.isArray(v)) return err(file, line, `${field} must be a list`)
		for (const p of v) {
			const n = normalizePerson(p)
			if (!n) err(file, line, `${field}: invalid person ${JSON.stringify(p)}`)
			else if (ctx.people?.size && !ctx.people.has(n.name.toLowerCase())) {
				warn(file, line, `${field}: "${n.name}" is not in people.yaml`)
			}
		}
	}
	const str = (file: string, line: number | undefined, field: string, v: unknown) => {
		if (v !== undefined && typeof v !== 'string') err(file, line, `${field} must be a string`)
	}
	const unknownKeys = (
		file: string,
		line: number | undefined,
		what: string,
		o: Record<string, unknown>,
		keys: Set<string>,
	) => {
		for (const k of Object.keys(o)) {
			if (!keys.has(k) && !k.startsWith('x-')) warn(file, line, `${what}: unknown key "${k}"`)
		}
	}

	// --- publication.md -------------------------------------------------------------
	const pf = 'publication.md'
	let seq: PageSequence | undefined
	if (unit.publication !== undefined) {
		let fm: ReturnType<typeof parseFrontmatter> = null
		try {
			fm = parseFrontmatter(unit.publication)
		} catch (e) {
			err(pf, 1, `invalid YAML: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
		}
		if (!fm && !out.length) err(pf, 1, 'missing YAML frontmatter (--- … ---)')
		if (fm && !isObj(fm.data)) err(pf, 1, 'frontmatter must be a mapping')
		if (fm && isObj(fm.data)) {
			const d = fm.data
			if (d.format !== FORMAT) err(pf, undefined, versionMessage('format', 'publication-md', d.format))
			if (typeof d.id !== 'string' || !RE_ID.test(d.id))
				err(pf, undefined, 'id: required, [A-Za-z0-9._|:-]')
			if (typeof d.type !== 'string' || !d.type) err(pf, undefined, 'type: required (CSL type)')
			for (const k of ['title', 'publisher', 'language', 'rights'] as const)
				str(pf, undefined, k, d[k])
			people(pf, undefined, 'authors', d.authors)
			people(pf, undefined, 'editors', d.editors)
			if (d.issued !== undefined && !RE_DATE.test(String(d.issued))) {
				err(pf, undefined, 'issued must be YYYY, YYYY-MM or YYYY-MM-DD')
			}
			for (const k of ['volume', 'issue'] as const) {
				if (d[k] !== undefined && typeof d[k] !== 'string' && typeof d[k] !== 'number') {
					err(pf, undefined, `${k} must be a string or number`)
				}
			}
			const ids = d.identifiers
			if (
				ids !== undefined &&
				(!isObj(ids) || Object.values(ids).some((x) => typeof x !== 'string' && typeof x !== 'number'))
			) {
				err(pf, undefined, 'identifiers must map keys to strings')
			}
			if (d.pageSequence !== undefined) {
				if (typeof d.pageSequence !== 'string') err(pf, undefined, 'pageSequence must be a string')
				else {
					try {
						seq = new PageSequence(d.pageSequence, unit.pages.length || undefined)
					} catch (e) {
						err(pf, undefined, `pageSequence: ${e instanceof Error ? e.message : e}`)
					}
				}
			}
			if (d.container !== undefined) {
				const c = d.container
				if (!isObj(c) || typeof c.type !== 'string') err(pf, undefined, 'container.type: required')
				else if (typeof c.id === 'string' && ctx.collections && !ctx.collections.has(c.id)) {
					err(pf, undefined, `container.id "${c.id}" has no collections/${c.id}.yaml`)
				}
			}
			if (d.source !== undefined) {
				const s = d.source
				if (!isObj(s)) err(pf, undefined, 'source must be a mapping')
				else if (s.kind !== undefined && s.kind !== 'scanned' && s.kind !== 'digital') {
					err(pf, undefined, 'source.kind must be scanned or digital')
				}
			}
			unknownKeys(pf, undefined, 'publication', d, PUBLICATION_KEYS)
		}
	}

	// --- page files -----------------------------------------------------------------
	// pageIndex → its printed labels in order (empty for an ignored `!` duplicate page).
	const labelsByIndex = new Map<number, string[]>()
	if (seq) {
		for (const label of seq.getLabelList()) {
			const idx = seq.getIndexList(label)?.[0]
			if (idx !== undefined) labelsByIndex.set(idx, [...(labelsByIndex.get(idx) ?? []), label])
		}
	}
	// Keys of the form `<unit>|<pages>|<n>` name printed pages; check them against pageSequence.
	const keyPages = (file: string, line: number, what: string, key: string) => {
		const pages = key.split('|')
		if (seq && pages.length === 3 && pages[1] && !seq.getIndexList(pages[1])) {
			warn(file, line, `${what}.key "${key}": pages "${pages[1]}" not in pageSequence`)
		}
	}
	const partKeys = new Map<string, string>()
	const figureIds = new Map<string, string>()
	for (const page of unit.pages) {
		const blocks = parseBlocks(page.text, page.name)
		const labels: string[] = []
		for (const [i, b] of blocks.entries()) {
			const { file, line } = b.loc
			switch (b.kind) {
				case 'page':
					labels.push(b.label)
					break
				case 'legacy-page':
					err(file, line, `old marker spelling — write <!-- page: ${b.label} -->`)
					labels.push(b.label)
					break
				case 'unknown-comment':
					err(
						file,
						line,
						`unknown comment ${JSON.stringify(b.raw.slice(0, 60))} — use page / part / figure / note`,
					)
					break
				case 'yaml-error':
					err(file, line, `${b.block}: invalid YAML: ${b.message}`)
					break
				case 'image':
					if (!b.ref) {
						if (b.src.startsWith('img/'))
							err(file, line, `image path "${b.src}" is not img/pNNN_pct-x,y,w,h.jpg`)
						else warn(file, line, `image "${b.src}" is not a region reference`)
					}
					break
				case 'part': {
					const v = b.value
					if (v === 'none') break
					if (!isObj(v)) {
						err(file, line, 'part must be a mapping or "none"')
						break
					}
					if (v.continued === true) {
						// Resumes an earlier part after an interruption (another part in between).
						if (typeof v.key !== 'string' || !partKeys.has(v.key)) {
							err(
								file,
								line,
								`part continues unknown key ${JSON.stringify(v.key)} (must be declared earlier)`,
							)
						}
						for (const k of Object.keys(v)) {
							if (k !== 'key' && k !== 'continued')
								err(file, line, `part continuation takes only key and continued, not "${k}"`)
						}
						break
					}
					if (typeof v.key !== 'string' || !v.key) err(file, line, 'part.key: required string')
					else if (partKeys.has(v.key))
						err(file, line, `part.key "${v.key}" already used in ${partKeys.get(v.key)}`)
					else {
						partKeys.set(v.key, `${file}:${line}`)
						keyPages(file, line, 'part', v.key)
					}
					if (typeof v.type !== 'string' || !v.type)
						err(file, line, 'part.type: required (CSL type, none, advertisement)')
					str(file, line, 'part.title', v.title)
					str(file, line, 'part.subtitle', v.subtitle)
					str(file, line, 'part.genre', v.genre)
					str(file, line, 'part.rights', v.rights)
					str(file, line, 'part.pages', v.pages)
					if (seq && typeof v.pages === 'string' && !seq.getIndexList(v.pages)) {
						err(file, line, `part.pages "${v.pages}" does not resolve in pageSequence`)
					}
					people(file, line, 'part.authors', v.authors)
					unknownKeys(file, line, 'part', v, PART_KEYS)
					break
				}
				case 'figure': {
					const v = b.value
					const prev = blocks[i - 1]
					if (prev?.kind !== 'image' || line - prev.loc.line > 1) {
						err(file, line, 'figure must directly follow its ![…](img/…) image (same or next line)')
					}
					if (!isObj(v)) {
						err(file, line, 'figure must be a mapping')
						break
					}
					if (v.id !== undefined)
						err(file, line, 'figure.id is now figure.key (same style as part keys)')
					if (typeof v.key !== 'string' || !v.key) err(file, line, 'figure.key: required string')
					else if (!/\|f\d+$/.test(v.key))
						err(file, line, `figure.key "${v.key}": must end in |f<n> (e.g. "1987-2|16|f1")`)
					else if (figureIds.has(v.key))
						err(file, line, `figure.key "${v.key}" already used in ${figureIds.get(v.key)}`)
					else {
						figureIds.set(v.key, `${file}:${line}`)
						keyPages(file, line, 'figure', v.key)
					}
					for (const k of ['kind', 'caption', 'license'] as const) str(file, line, `figure.${k}`, v[k])
					people(file, line, 'figure.creators', v.creators)
					unknownKeys(file, line, 'figure', v, FIGURE_KEYS)
					break
				}
				case 'note': {
					const v = b.value
					if (!isObj(v) || typeof v.type !== 'string' || !NOTE_TYPES.has(v.type)) {
						err(file, line, 'note.type: transcription or editorial')
					}
					if (!isObj(v) || typeof v.text !== 'string' || !v.text.trim())
						err(file, line, 'note.text: required')
					break
				}
			}
		}
		const idx = Number(/pageIndex-(\d+)\.md$/.exec(page.name)?.[1] ?? Number.NaN)
		if (seq && !Number.isNaN(idx)) {
			// Markers are positional: required where a PDF page carries several printed pages
			// (where each one starts), optional on a single-label page, absent on an ignored one.
			const expected = labelsByIndex.get(idx) ?? []
			const same =
				labels.map((l) => l.toLowerCase()).join('|') === expected.map((l) => l.toLowerCase()).join('|')
			if (!same && (expected.length > 1 || labels.length > 0)) {
				err(
					page.name,
					undefined,
					`page markers ${JSON.stringify(labels)} ≠ pageSequence labels ${JSON.stringify(expected)} for pageIndex ${idx}`,
				)
			}
		} else {
			const nums = labels.filter((l) => /^\d+$/.test(l)).map(Number)
			if (nums.some((f, i) => i > 0 && f < (nums[i - 1] ?? 0))) {
				err(page.name, undefined, `page markers out of order ${JSON.stringify(labels)}`)
			}
		}
	}
	return out
}

/** Split a unit's pages into its parts, in reading order (text before the first part is `null`). */
export function collectParts(
	pages: { name: string; text: string }[],
): { part: unknown; pages: string[]; text: string }[] {
	const out: { part: unknown; pages: string[]; text: string }[] = [
		{ part: null, pages: [], text: '' },
	]
	const byKey = new Map<string, { part: unknown; pages: string[]; text: string }>()
	let cur = out[0] as { part: unknown; pages: string[]; text: string }
	for (const page of pages) {
		let pos = 0
		const starts = parseBlocks(page.text, page.name).filter((b) => b.kind === 'part')
		const offsets = [...page.text.matchAll(/<!--\s*part:[\s\S]*?-->/g)].map((m) => m.index)
		const push = (text: string) => {
			if (!text.trim()) return
			if (!cur.pages.includes(page.name)) cur.pages.push(page.name)
			cur.text += text
		}
		for (const [i, b] of starts.entries()) {
			const at = offsets[i] ?? 0
			push(page.text.slice(pos, at))
			const v = b.kind === 'part' ? b.value : null
			const key = isObj(v) && typeof v.key === 'string' ? v.key : null
			const resumed = isObj(v) && v.continued === true && key ? byKey.get(key) : undefined
			if (resumed) cur = resumed
			else {
				cur = { part: v, pages: [], text: '' }
				out.push(cur)
				if (key) byKey.set(key, cur)
			}
			pos = at
		}
		push(page.text.slice(pos))
	}
	return out[0]?.text.trim() ? out : out.slice(1)
}
