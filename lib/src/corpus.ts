import { PageSequence } from '@tvartom/pagesequence'
import { type ContentConfig, unitId } from './contentConfig.ts'
import { parseBlocks, parseFrontmatter } from './parse.ts'
import { findLinks, parseRef, parseSubject, type RefNamespaces, type RefTarget, refId, refNamespaceOf, refPath } from './refs.ts'
import type { Problem } from './types.ts'

/**
 * A whole content repo, indexed for cross-unit work: unit ids, printed page labels, part and
 * figure keys. Pure — callers read the files (Node, R2, …) and pass them in.
 */
export interface CorpusUnitInput {
	/** Folder name, e.g. `SSF_Grottan_1987_2_webb-content`. */
	folder: string
	publication?: string
	pages: { name: string; text: string }[]
}

export interface CorpusUnit extends CorpusUnitInput {
	id: string
	title?: string
	/** printed label (lower-case) → pageIndex; null when the unit declares no labels at all */
	labels: Map<string, number> | null
	/** part/figure key → page file name */
	keys: Map<string, string>
}

export interface Corpus {
	units: Map<string, CorpusUnit>
	namespaces: RefNamespaces
	config: ContentConfig
}

const idxOf = (file: string) => Number(/pageIndex-(\d+)\.md$/.exec(file)?.[1] ?? Number.NaN)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function buildCorpus(inputs: CorpusUnitInput[], config: ContentConfig): Corpus {
	const units = new Map<string, CorpusUnit>()
	for (const u of inputs) {
		const fm = u.publication ? (() => { try { return parseFrontmatter(u.publication ?? '') } catch { return null } })() : null
		const d = isObj(fm?.data) ? fm.data : {}
		const id = typeof d.id === 'string' ? d.id : unitId(config, u.folder.replace(/-content$/, ''))
		let labels: Map<string, number> | null = null
		if (typeof d.pageSequence === 'string') {
			const seq = PageSequence.create(d.pageSequence)
			if (seq) {
				labels = new Map()
				for (const l of seq.getLabelList()) {
					const i = seq.getIndexList(l)?.[0]
					if (i !== undefined) labels.set(l.toLowerCase(), i)
				}
			}
		}
		const keys = new Map<string, string>()
		for (const p of u.pages) {
			for (const b of parseBlocks(p.text, p.name)) {
				if (b.kind === 'page' && !d.pageSequence) {
					labels ??= new Map()
					if (!labels.has(b.label.toLowerCase())) labels.set(b.label.toLowerCase(), idxOf(p.name))
				}
				if ((b.kind === 'part' || b.kind === 'figure') && isObj(b.value) && typeof b.value.key === 'string' && b.value.continued !== true) {
					keys.set(b.value.key, p.name)
				}
			}
		}
		const unit: CorpusUnit = { ...u, id, labels, keys }
		if (typeof d.title === 'string') unit.title = d.title
		units.set(id, unit)
	}
	const refs = Object.entries(config.refs ?? {})
	const namespaces: RefNamespaces = {
		units: new Set(refs.filter(([, v]) => v?.units).map(([k]) => k)),
		entities: new Set(refs.filter(([, v]) => !v?.units).map(([k]) => k)),
	}
	return { units, namespaces, config }
}

/** pageIndex of a printed label; for a unit without labels, assumes label N = pageIndex N-1. */
export function resolveLabel(u: CorpusUnit, label: string): { index: number; assumed: boolean } | null {
	if (u.labels) {
		const i = u.labels.get(label.toLowerCase())
		return i === undefined ? null : { index: i, assumed: false }
	}
	const n = Number(label)
	return Number.isInteger(n) && n >= 1 && n <= u.pages.length ? { index: n - 1, assumed: true } : null
}

/** Printed label at a line of a page file: last marker above it, else the sequence, else index+1. */
export function labelAt(u: CorpusUnit, file: string, line: number): string {
	const page = u.pages.find((p) => p.name === file)
	let label: string | undefined
	if (page) for (const b of parseBlocks(page.text, file)) if (b.kind === 'page' && b.loc.line <= line) label = b.label
	if (label) return label
	const idx = idxOf(file)
	if (u.labels) for (const [l, i] of u.labels) if (i === idx) return l
	return String(idx + 1)
}

export interface Mention {
	unit: CorpusUnit
	file: string
	line: number
	label: string
	text: string
	kind: 'mention' | 'subject'
	/** key of the part/figure carrying a subject */
	of?: string
}

export interface RefEntry {
	target: RefTarget
	mentions: Mention[]
}

/** Every reference in the corpus, grouped by target, plus problems found on the way. */
export function collectRefs(corpus: Corpus): { refs: Map<string, RefEntry>; problems: Problem[] } {
	const refs = new Map<string, RefEntry>()
	const problems: Problem[] = []
	const add = (t: RefTarget, m: Mention) => {
		const k = refId(t)
		const e = refs.get(k) ?? { target: t, mentions: [] }
		e.mentions.push(m)
		refs.set(k, e)
	}
	const check = (t: RefTarget, file: string, line: number, raw: string) => {
		const err = (message: string) => problems.push({ level: 'error', file, line, message: `${raw}: ${message}` })
		if (t.kind === 'entity' || t.kind === 'unresolved') return true
		const u = corpus.units.get(t.unit)
		if (!u) return err(`no unit "${t.unit}" in this repo`), false
		if (t.kind === 'page' && !resolveLabel(u, t.label)) return err(`unit ${t.unit} has no printed page "${t.label}"`), false
		if (t.kind === 'key' && !u.keys.has(t.key)) return err(`unit ${t.unit} has no part/figure key "${t.key}"`), false
		return true
	}
	for (const u of corpus.units.values()) {
		const scan = [...(u.publication ? [{ name: 'publication.md', text: u.publication }] : []), ...u.pages]
		for (const p of scan) {
			for (const l of findLinks(p.text)) {
				if (!/(^|\/)ref\//.test(l.href)) continue
				const where = `${u.folder}/${p.name}`
				const t = parseRef(l.href, corpus.namespaces)
				if (!t) {
					const ns = refNamespaceOf(l.href)
					const declared = ns !== null && (corpus.namespaces.units.has(ns) || corpus.namespaces.entities.has(ns))
					const message = ns !== null && !declared
						? `${l.href}: namespace "${ns}" is not declared under refs: in publication-md.yaml`
						: `${l.href}: not a ref/<namespace>/<id>.md path`
					problems.push({ level: 'error', file: where, line: l.line, message })
					continue
				}
				if (!l.href.startsWith('../ref/')) {
					problems.push({ level: 'warning', file: where, line: l.line, message: `${l.href}: write ../${refPath(t)} so the link works from the page file` })
				}
				if (check(t, where, l.line, l.href)) {
					add(t, { unit: u, file: p.name, line: l.line, label: p.name === 'publication.md' ? '' : labelAt(u, p.name, l.line), text: l.text, kind: 'mention' })
				}
			}
			for (const b of p.name === 'publication.md' ? [] : parseBlocks(p.text, p.name)) {
				if ((b.kind !== 'part' && b.kind !== 'figure') || !isObj(b.value) || b.value.subjects === undefined) continue
				const where = `${u.folder}/${p.name}`
				if (!Array.isArray(b.value.subjects)) {
					problems.push({ level: 'error', file: where, line: b.loc.line, message: `${b.kind}.subjects must be a list` })
					continue
				}
				for (const s of b.value.subjects) {
					const t = typeof s === 'string' ? parseSubject(s, corpus.namespaces) : null
					if (!t || t.kind === 'unresolved') {
						problems.push({ level: 'error', file: where, line: b.loc.line, message: `${b.kind}.subjects: ${JSON.stringify(s)} is not a resolved reference (e.g. basen/1234)` })
						continue
					}
					if (check(t, where, b.loc.line, String(s))) {
						const m: Mention = { unit: u, file: p.name, line: b.loc.line, label: labelAt(u, p.name, b.loc.line), text: String(b.value.title ?? b.value.caption ?? b.value.key ?? ''), kind: 'subject' }
						if (typeof b.value.key === 'string') m.of = b.value.key
						add(t, m)
					}
				}
			}
		}
	}
	return { refs, problems }
}
