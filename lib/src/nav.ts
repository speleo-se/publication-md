import { PageSequence } from '@tvartom/pagesequence'
import { parseFrontmatter } from './parse.ts'

/**
 * Navigation lines: a generated line of links to the previous/next page file, so a unit can be
 * proof-read page by page in any markdown viewer (GitHub). It is NOT content — consumers drop the
 * whole line (`stripNav`) before using the text. Spec §3.6.
 *
 *     [⬅️ s. 4](pageIndex-003.md)  │  [📖 Grottan 1987 nr 2](publication.md)  │  [s. 6 ➡️](pageIndex-005.md) <!-- nav: generated -->
 *
 * The marker ends the line: a line that STARTS with `<!--` is an HTML block in CommonMark (GitHub,
 * VS Code), and its links would not render.
 *
 * Where it goes is the content repo's choice (`nav.position` in publication-md.yaml, default
 * `bottom`); the line is written by `npm run nav`, in the page files of the deliverable.
 */

export type NavPosition = 'bottom' | 'top' | 'both' | 'none'
export const NAV_POSITIONS: readonly NavPosition[] = ['bottom', 'top', 'both', 'none']
export const NAV_MARK = '<!-- nav: generated -->'
/** Between the links: a box-drawing bar (never `|`, which can start a table) padded with NBSP so the air survives markdown's whitespace collapsing. */
export const NAV_SEP = '\u00a0 \u2502 \u00a0'

const RE_NAV_LINE = /^\[.*\) <!-- nav: generated -->$/
const isNav = (line: string) => RE_NAV_LINE.test(line)

/** True when a line is a navigation line. */
export const isNavLine = isNav

/**
 * Remove every navigation line, and the blank line that separates a leading/trailing one from the
 * text. `stripNav(applyNav(t, …))` gives back `t` for any page that ends in one newline.
 */
export function stripNav(text: string): string {
	if (!text.includes(NAV_MARK)) return text
	const lines = text.split('\n')
	while (lines.length && isNav(lines[0] ?? '')) {
		lines.shift()
		if (lines[0] === '') lines.shift()
	}
	const trailing = lines.at(-1) === '' ? lines.pop() : undefined
	while (lines.length && isNav(lines.at(-1) ?? '')) {
		lines.pop()
		if (lines.at(-1) === '') lines.pop()
	}
	const body = lines.filter((l) => !isNav(l))
	if (trailing !== undefined) body.push('')
	return body.join('\n')
}

/** Put `line` at `position` in a page's text (any old navigation line is replaced). */
export function applyNav(text: string, line: string | null, position: NavPosition): string {
	const base = stripNav(text)
	if (!line || position === 'none') return base
	const body = base.replace(/\n+$/, '')
	const top = position === 'top' || position === 'both'
	const bottom = position === 'bottom' || position === 'both'
	return `${top ? `${line}\n\n` : ''}${body}${bottom ? `\n\n${line}` : ''}\n`
}

export interface NavLabels {
	/** "p." / "s." — prefix of a printed page label. */
	page: string
	/** Used when a page file has no printed label (e.g. "PDF p."). */
	pdf: string
	/** Table of contents: heading, column heads, page list label. */
	contents: string
	cols: [string, string, string]
	pages: string
	/** Generated correction of a printed TOC page, and the toc's list of them. */
	corrected: string
	corrections: string
	/** Credit role → printed form (e.g. photographer → "foto"). */
	roles: Record<string, string>
}

export const NAV_LABELS: Record<'sv' | 'en', NavLabels> = {
	sv: {
		page: 's.',
		pdf: 'PDF-sida',
		contents: 'Innehåll',
		cols: ['Sid', 'Artikel', 'Författare'],
		pages: 'Sidor',
		corrected: 'Rättad',
		corrections: 'Rättelser i den tryckta innehållsförteckningen',
		roles: { photographer: 'foto', illustrator: 'teckning', editor: 'red.', translator: 'övers.', cartographer: 'karta' },
	},
	en: {
		page: 'p.',
		pdf: 'PDF p.',
		contents: 'Contents',
		cols: ['Page', 'Title', 'Authors'],
		pages: 'Pages',
		corrected: 'Corrected',
		corrections: 'Corrections to the printed contents',
		roles: { photographer: 'photo', illustrator: 'drawings', editor: 'ed.', translator: 'trans.', cartographer: 'map' },
	},
}

const idxOf = (file: string) => Number(/pageIndex-(\d+)\.md$/.exec(file)?.[1] ?? Number.NaN)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Page file → its printed label(s) as text (`12`, `16–17`), or null for an unlabelled page. */
function pageLabels(unit: { publication?: string; pages: { name: string }[] }): Map<string, string | null> {
	const byIndex = new Map<number, string[]>()
	try {
		const fm = unit.publication ? parseFrontmatter(unit.publication) : null
		const d = fm?.data as Record<string, unknown> | undefined
		const seq = typeof d?.pageSequence === 'string' ? PageSequence.create(d.pageSequence) : null
		for (const l of seq?.getLabelList() ?? []) {
			const i = seq?.getIndexList(l)?.[0]
			if (i !== undefined) byIndex.set(i, [...(byIndex.get(i) ?? []), l])
		}
	} catch {
		// an invalid publication.md is reported by validate; fall back to PDF page numbers
	}
	const out = new Map<string, string | null>()
	for (const { name } of unit.pages) {
		const ls = byIndex.get(idxOf(name))
		out.set(name, ls?.length ? (ls.length > 1 ? `${ls[0]}–${ls.at(-1)}` : (ls[0] ?? null)) : null)
	}
	return out
}

const sortFiles = (pages: { name: string }[]) => pages.map((p) => p.name).sort((a, b) => idxOf(a) - idxOf(b))

/**
 * The navigation line of every page file of one unit, by file name. `title` names the unit (the
 * middle link to `publication.md`, or to the first page when there is none).
 */
export function navLines(
	unit: { publication?: string; pages: { name: string }[] },
	title: string,
	labels: NavLabels = NAV_LABELS.en,
): Map<string, string> {
	const files = sortFiles(unit.pages)
	const pl = pageLabels(unit)
	const name = (file: string) => {
		const l = pl.get(file)
		return l ? `${labels.page} ${l}` : `${labels.pdf} ${idxOf(file) + 1}`
	}
	const home = unit.publication !== undefined ? 'publication.md' : files[0]
	const out = new Map<string, string>()
	for (const [i, f] of files.entries()) {
		const prev = files[i - 1]
		const next = files[i + 1]
		const parts = [
			...(prev ? [`[⬅️ ${name(prev)}](${prev})`] : []),
			...(home ? [`[📖 ${title}](${home})`] : []),
			...(next ? [`[${name(next)} ➡️](${next})`] : []),
		]
		out.set(f, `${parts.join(NAV_SEP)} ${NAV_MARK}`)
	}
	return out
}

// --- table of contents in publication.md ------------------------------------------------------

export const TOC_START = '<!-- toc: start -->'
export const TOC_END = '<!-- toc: end -->'

/** Where the table of contents goes in `publication.md`: before or after the body text. */
export type TocPosition = 'top' | 'bottom' | 'none'
export const TOC_POSITIONS: readonly TocPosition[] = ['top', 'bottom', 'none']

/** Remove the generated table of contents (and the blank line that set it apart) from a `publication.md` text. */
export function stripToc(text: string): string {
	if (!text.includes(TOC_START)) return text
	const lines = text.split('\n')
	for (;;) {
		const s = lines.indexOf(TOC_START)
		const e = s < 0 ? -1 : lines.indexOf(TOC_END, s)
		if (e < 0) break
		lines.splice(s, e - s + 1)
		if (lines[s - 1] === '' && lines[s] === '') lines.splice(s, 1)
	}
	return lines.join('\n')
}

/**
 * Put `block` (from `tocBlock`) into a `publication.md` text, replacing an old one: `top` right
 * after the frontmatter (before the body text), `bottom` after the body text.
 */
export function applyToc(text: string, block: string | null, position: TocPosition = 'bottom'): string {
	const base = stripToc(text)
	if (!block || position === 'none') return base
	if (position === 'bottom') return `${base.replace(/\n+$/, '')}\n\n${block}\n`
	const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(base)?.[0] ?? ''
	const body = base.slice(fm.length).replace(/^\n+/, '')
	return `${fm}\n${block}\n${body ? `\n${body}` : ''}`
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

function credits(v: unknown, roles: Record<string, string>): string {
	if (!Array.isArray(v)) return ''
	return v
		.map((a) => {
			if (typeof a === 'string') return a
			if (!isObj(a) || typeof a.name !== 'string') return ''
			const role = typeof a.role === 'string' && a.role !== 'author' ? (roles[a.role] ?? a.role) : ''
			return role ? `*${role}:* ${a.name}` : a.name
		})
		.filter(Boolean)
		.join(', ')
}

/**
 * The generated table of contents of a unit (between `TOC_START`/`TOC_END`): every part (from its
 * `part` block, in reading order) linked to the page file where it starts, then every page.
 * `parts` is what `parseBlocks` found, per page file. Null when the unit has no parts.
 */
export function tocBlock(
	unit: { publication?: string; pages: { name: string }[] },
	parts: { file: string; value: unknown }[],
	labels: NavLabels = NAV_LABELS.en,
	corrections: TocCorrection[] = [],
): string | null {
	const pl = pageLabels(unit)
	const rows: string[] = []
	for (const { file, value: v } of parts) {
		if (!isObj(v) || v.continued === true || typeof v.key !== 'string') continue
		const pages = typeof v.pages === 'string' || typeof v.pages === 'number' ? String(v.pages).replace(/(\d)-(\d)/g, '$1–$2') : (pl.get(file) ?? '')
		const title = cell(typeof v.title === 'string' && v.title ? v.title : v.key)
		rows.push(`| [${cell(pages)}](${file}) | [${title}](${file}) | ${cell(credits(v.authors, labels.roles))} |`)
	}
	if (!rows.length) return null
	const pageList = sortFiles(unit.pages)
		.map((f) => `[${pl.get(f) ?? `(${idxOf(f) + 1})`}](${f})`)
		.join(' · ')
	return [
		TOC_START,
		`## ${labels.contents}`,
		'',
		`| ${labels.cols.join(' | ')} |`,
		'|---|---|---|',
		...rows,
		'',
		`**${labels.pages}:** ${pageList}`,
		...(corrections.length
			? ['', `**${labels.corrections}:** ${corrections.map((c) => `[${cell(c.title)}](${c.file}) ${labels.page} ${c.printed} → ${c.correct}`).join('; ')}`]
			: []),
		TOC_END,
	].join('\n')
}

// --- corrections in printed tables of contents --------------------------------------------------

export const CORRECTION_MARK = '<!-- toc: correction -->'
const RE_CORRECTION = / ?\([^()|\n]*\)<!-- toc: correction -->/g

/** Remove generated corrections (`4 (Rättad: 6)<!-- toc: correction -->` → `4`). */
export function stripCorrections(text: string): string {
	return text.includes(CORRECTION_MARK) ? text.replace(RE_CORRECTION, '') : text
}

/** Everything generated (navigation lines, corrections): what a page file says as printed. */
export const stripGenerated = (text: string): string => stripCorrections(stripNav(text))

export interface TocCorrection {
	file: string
	title: string
	printed: string
	correct: string
}

const splitRow = (line: string) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/)
const RE_PAGE_CELL = /^\s*(\d+|[ivxlcdm]+)\s*(?:[-–—]\s*\S+)?\s*$/i

/**
 * Generated corrections in a printed table of contents. A table row whose title links to a part of
 * this unit (`../ref/<ns>/<local>/part/<rest>.md`) and whose page cell gives a different first page
 * than the part's first printed page gets `(<word>: <page>)<!-- toc: correction -->` after the
 * printed page. Only the first page counts: a missing row or other end pages are not corrections.
 * `starts`: part key without the unit segment, `|` as `~` → its first printed page.
 */
export function applyCorrections(
	text: string,
	ns: string,
	local: string,
	starts: Map<string, string>,
	word: string,
	file = '',
): { text: string; corrections: TocCorrection[] } {
	const base = stripCorrections(text)
	const corrections: TocCorrection[] = []
	const prefix = `../ref/${ns}/${local}/part/`
	const lines = base.split('\n').map((line) => {
		if (!line.trimStart().startsWith('|') || !line.includes(prefix)) return line
		const cells = splitRow(line)
		const li = cells.findIndex((c) => c.includes(prefix))
		const link = /\[([^\]]*)\]\(([^)\s]+)\)/.exec(cells[li] ?? '')
		const rest = link?.[2]?.slice(link[2].indexOf(prefix) + prefix.length).replace(/\.md$/, '')
		const correct = rest ? starts.get(rest) : undefined
		let pi = -1
		for (let i = cells.length - 1; i > li; i--) if (RE_PAGE_CELL.test(cells[i] ?? '')) { pi = i; break }
		if (!correct || pi < 0) return line
		const printed = RE_PAGE_CELL.exec(cells[pi] ?? '')?.[1] ?? ''
		if (printed.toLowerCase() === correct.toLowerCase()) return line
		corrections.push({ file, title: link?.[1] ?? '', printed, correct })
		cells[pi] = `${(cells[pi] ?? '').replace(/\s+$/, '')} (${word}: ${correct})${CORRECTION_MARK} `
		return `|${cells.join('|')}|`
	})
	return { text: lines.join('\n'), corrections }
}
