import { parse as parseYaml } from 'yaml'
import { findLinks, parseRef, type RefNamespaces } from './refs.ts'
import type { Problem } from './types.ts'

/**
 * Names files: the shared decisions for linking printed names to an entity namespace
 * (`refs.<ns>.names` in publication-md.yaml, e.g. data/cave-names.yaml for `ssf`). Every markup
 * worker reads and extends the same list, so a name is linked the same way in every unit.
 *
 *   - printed: [Sotbäcksgrottan, Sotsbäcksgrottan, Sotsbäcksgrottans]
 *     id: 1751                        # always this entity
 *   - printed: [Labyrintgrottan]
 *     candidates: [1752, 4095]        # ambiguous: decide per mention from context
 *     hint: "Kebnekaise / Tarfala → 1752"
 *   - printed: [Lulletjårrogrottan]
 *     id: unknown                     # checked: not in the authority — keep ../ref/<ns>/unknown.md
 */
export interface NameEntry {
	printed: string[]
	/** Fixed target, or `unknown`. Absent when `candidates` is given. */
	id?: string
	candidates?: string[]
	hint?: string
	note?: string
}

export type NameIndex = Map<string, NameEntry>

/**
 * Normalised lookup key of a printed name: NFC, lower case, collapsed whitespace, without a
 * trailing parenthesised catalogue number that is part of the link text ("Frubergsgrytet (B4)").
 */
export const nameKey = (s: string) =>
	s
		.normalize('NFC')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.replace(/ \([a-zåäö]{1,2} ?\d+[a-z]?\)$/, '')
		.trim()

export function parseNames(text: string, file = 'names'): { entries: NameEntry[]; index: NameIndex; problems: Problem[] } {
	const problems: Problem[] = []
	const err = (message: string) => problems.push({ level: 'error', file, message })
	const data: unknown = parseYaml(text) ?? []
	const entries: NameEntry[] = []
	const index: NameIndex = new Map()
	if (!Array.isArray(data)) {
		err('must be a list of {printed, id | candidates}')
		return { entries, index, problems }
	}
	for (const [i, raw] of data.entries()) {
		const e = raw as Record<string, unknown>
		const printed = Array.isArray(e?.printed) ? e.printed.map(String) : null
		if (!printed?.length) {
			err(`entry ${i}: printed: [names] required`)
			continue
		}
		const entry: NameEntry = { printed }
		if (e.id !== undefined) entry.id = String(e.id)
		if (Array.isArray(e.candidates)) entry.candidates = e.candidates.map(String)
		if (typeof e.hint === 'string') entry.hint = e.hint
		if (typeof e.note === 'string') entry.note = e.note
		if ((entry.id === undefined) === (entry.candidates === undefined)) {
			err(`entry ${i} (${printed[0]}): give exactly one of id or candidates`)
			continue
		}
		for (const p of printed) {
			const k = nameKey(p)
			const other = index.get(k)
			if (other && other !== entry) err(`"${p}" is in two entries (${other.printed[0]} and ${printed[0]})`)
			index.set(k, entry)
		}
		entries.push(entry)
	}
	return { entries, index, problems }
}

export interface NameMismatch {
	file: string
	line: number
	text: string
	href: string
	/** What the link points at now: an id, or `unknown`. */
	current: string
	/** The fixed id (or `unknown`) it should point at; absent for a wrong candidate. */
	expected?: string
	candidates?: string[]
}

/**
 * Check one page's links into namespace `ns` against the names index. Returns mismatches and the
 * printed names not in the index (to add).
 */
export function checkNames(
	text: string,
	file: string,
	ns: string,
	index: NameIndex,
	namespaces: RefNamespaces,
): { mismatches: NameMismatch[]; unlisted: string[] } {
	const mismatches: NameMismatch[] = []
	const unlisted: string[] = []
	for (const l of findLinks(text)) {
		const t = parseRef(l.href, namespaces)
		if (!t || (t.kind !== 'entity' && t.kind !== 'unresolved') || t.ns !== ns) continue
		const current = t.kind === 'entity' ? t.id : 'unknown'
		const e = index.get(nameKey(l.text))
		if (!e) {
			unlisted.push(l.text)
			continue
		}
		const base = { file, line: l.line, text: l.text, href: l.href, current }
		if (e.id !== undefined && e.id !== current) mismatches.push({ ...base, expected: e.id })
		else if (e.candidates && current !== 'unknown' && !e.candidates.includes(current)) {
			mismatches.push({ ...base, candidates: e.candidates })
		}
	}
	return { mismatches, unlisted }
}

/** Rewrite the targets of fixed-id mismatches in a page's text (link text untouched). */
export function applyNames(text: string, mismatches: NameMismatch[]): string {
	const lines = text.split('\n')
	for (const m of mismatches) {
		if (m.expected === undefined) continue
		const i = m.line - 1
		const line = lines[i]
		if (line === undefined) continue
		const to = m.href.replace(/[^/]+\.md$/, `${m.expected}.md`)
		const from = `[${m.text}](${m.href})`
		if (line.includes(from)) lines[i] = line.replace(from, `[${m.text}](${to})`)
	}
	return lines.join('\n')
}
