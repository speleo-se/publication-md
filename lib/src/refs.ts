/**
 * References: links from the text to other units, pages, parts/figures and to external
 * entities (caves, people, places …), written as ordinary relative markdown links to
 * generated files under the content repo's `ref/` folder:
 *
 *     [Grottan 4/86](../ref/grottan/1986-4.md)                    a unit (namespace `grottan`, units: true)
 *     [Grottan nr 4, 1982](../ref/grottan/1982-4/page/22.md)       page 22 of a unit
 *     [Neotektonik …](../ref/grottan/1987-2/part/4-9~1.md)         part 1987-2|4-9|1
 *     [omslaget](../ref/grottan/1987-2/figure/1~f1.md)             figure 1987-2|1|f1
 *     [Torekulla kyrka](../ref/ssf/933.md)                         an entity in namespace `ssf`
 *     [Kalkgrottan](../ref/ssf/unknown.md)                         type known, id not yet
 *
 * Every target sits in a namespace folder declared under `refs:` in publication-md.yaml. The path
 * IS the identity, so the links work in any markdown viewer (the generated file forwards to the
 * target) and tools read them without special syntax. Below a unit, the folder names the kind
 * (`page`, `part`, `figure`) — no one-letter prefixes. A part/figure file is its key without the
 * leading unit segment (already in the path), `|` written `~`. Spec §3.5.
 */

/** A parsed reference target. Unit ids are `<namespace>-<local id>` (e.g. `grottan-1982-4`). */
export type RefTarget =
	| { kind: 'unit'; ns: string; unit: string }
	| { kind: 'page'; ns: string; unit: string; label: string }
	| { kind: 'key'; ns: string; unit: string; key: string }
	| { kind: 'entity'; ns: string; id: string }
	| { kind: 'unresolved'; ns: string }

/** Declared namespaces: `units` hold publication units (`ref/<ns>/<local id>…`), the rest entities. */
export interface RefNamespaces {
	units: ReadonlySet<string>
	entities: ReadonlySet<string>
}

const RE_REF = /(?:^|\/)ref\/((?:[^/]+\/){1,3}[^/]+)\.md$/
const RE_SEG = /^[A-Za-z0-9][A-Za-z0-9.,_~-]*$/

/**
 * Parse a `ref/<namespace>/…/<id>.md` path (any leading `../`). Returns null for links that are
 * not references, and for undeclared namespaces (check `refNamespaceOf` to tell them apart).
 */
export function parseRef(href: string, ns: RefNamespaces): RefTarget | null {
	const m = RE_REF.exec(href)
	if (!m) return null
	const segs = (m[1] ?? '').split('/').map((x) => decodeURIComponent(x))
	if (!segs.every((x) => RE_SEG.test(x))) return null
	const [a = '', b = '', c, d] = segs
	if (ns.entities.has(a)) {
		if (c !== undefined) return null
		return b === 'unknown' ? { kind: 'unresolved', ns: a } : { kind: 'entity', ns: a, id: b }
	}
	if (!ns.units.has(a)) return null
	const unit = `${a}-${b}`
	if (c === undefined) return { kind: 'unit', ns: a, unit }
	if (d === undefined) return null
	if (c === 'page' && !d.includes('~')) return { kind: 'page', ns: a, unit, label: d }
	const key = `${b}|${d.replaceAll('~', '|')}`
	if (c === 'part' && !isFigureKey(key)) return { kind: 'key', ns: a, unit, key }
	if (c === 'figure' && isFigureKey(key)) return { kind: 'key', ns: a, unit, key }
	return null
}

/** The namespace segment of a `ref/` path, declared or not. */
export function refNamespaceOf(href: string): string | null {
	return RE_REF.exec(href)?.[1]?.split('/')[0] ?? null
}

/** Figure keys end in `|f<n>` (part keys in a plain number). */
export const isFigureKey = (key: string) => /\|f\d+$/.test(key)

const local = (t: { ns: string; unit: string }) => t.unit.slice(t.ns.length + 1)

/** The `ref/…` path (relative to the content repo root) for a target. */
export function refPath(t: RefTarget): string {
	switch (t.kind) {
		case 'unit':
			return `ref/${t.ns}/${local(t)}.md`
		case 'page':
			return `ref/${t.ns}/${local(t)}/page/${t.label}.md`
		case 'key': {
			const rest = t.key.slice(t.key.indexOf('|') + 1).replaceAll('|', '~')
			return `ref/${t.ns}/${local(t)}/${isFigureKey(t.key) ? 'figure' : 'part'}/${rest}.md`
		}
		case 'entity':
			return `ref/${t.ns}/${t.id}.md`
		case 'unresolved':
			return `ref/${t.ns}/unknown.md`
	}
}

/** Canonical string form: `unit`, `unit@label`, `unit#key`, `ns:id`, `ns:?`. */
export function refId(t: RefTarget): string {
	switch (t.kind) {
		case 'unit':
			return t.unit
		case 'page':
			return `${t.unit}@${t.label}`
		case 'key':
			return `${t.unit}#${t.key}`
		case 'entity':
			return `${t.ns}:${t.id}`
		case 'unresolved':
			return `${t.ns}:?`
	}
}

/**
 * `subjects:` entries in part/figure blocks use the same identity without the file
 * decoration: `ssf/933`, `grottan/1982-4/page/22`, `grottan/1987-2/part/4-9~1`, or a full `../ref/…/….md` link.
 */
export function parseSubject(s: string, ns: RefNamespaces): RefTarget | null {
	const path = s.endsWith('.md') ? s : `ref/${s}.md`
	return parseRef(path, ns)
}

export interface LinkHit {
	text: string
	href: string
	line: number
}

/** Markdown links (not images) in a text, with 1-based line numbers. */
export function findLinks(text: string): LinkHit[] {
	const out: LinkHit[] = []
	const lines = text.split('\n')
	for (const [i, line] of lines.entries()) {
		for (const m of line.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g)) {
			if (m[1]) continue
			out.push({ text: m[2] ?? '', href: m[3] ?? '', line: i + 1 })
		}
	}
	return out
}
