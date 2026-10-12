/**
 * publication-md — a plain-text format for transcribed publications (periodical issues,
 * books, standalone articles, reports, …). Field names follow CSL-JSON / Dublin Core so
 * the data maps onto citation tooling; image regions follow the IIIF Image API.
 *
 * The human-readable spec lives in the content repo at `schema/README.md`.
 */

/** The publication-md version these tools implement (format, content config, workflow tag). */
export const CURRENT_VERSION = '0.1'
export const FORMAT = `publication-md/${CURRENT_VERSION}` as const

/** A person reference. `name` should match a canonical name (or alias) in `people.yaml`. */
export interface Person {
	name: string
	/** Free role, e.g. author, editor, photographer, illustrator, translator, cartographer. */
	role?: string
}

/** CSL-JSON item type of a unit or part, or a non-work marker for parts. */
export type CslType =
	| 'article'
	| 'article-journal'
	| 'article-magazine'
	| 'article-newspaper'
	| 'book'
	| 'chapter'
	| 'document'
	| 'entry'
	| 'figure'
	| 'map'
	| 'pamphlet'
	| 'periodical'
	| 'report'
	| 'review'
	| 'thesis'
	| (string & {})

export interface Container {
	/** `periodical`, `series`, `book` (for a chapter), … */
	type: string
	/** Key of `collections/<id>.yaml` when the container is described there. */
	id?: string
	title?: string
	issn?: string
	isbn?: string
	/** Number within a series. */
	number?: string | number
	/** Page range in the container, for a standalone article (e.g. "12-17"). */
	page?: string
}

/** `publication.md` frontmatter: one physical source unit (one PDF / scan set). */
export interface Publication {
	format: typeof FORMAT
	/** Stable repo-local key. Never an external database id. */
	id: string
	type: CslType
	title?: string
	authors?: Person[]
	editors?: Person[]
	/** ISO 8601 date or partial date (`1987`, `1987-05`, `1987-05-12`). */
	issued?: string | number
	publisher?: string
	language?: string
	identifiers?: Record<string, string>
	rights?: string
	container?: Container
	volume?: string | number
	issue?: string | number
	source?: { file?: string; kind?: 'scanned' | 'digital' }
	/**
	 * Printed page labels of every PDF page, in PageSequence syntax (`@tvartom/pagesequence`,
	 * the same string as the TOC sheet and Speleotastic `df.pageSequence`), e.g.
	 * `Omslag|2,3-30,!30,31-36`. The single source of truth for pageIndex ↔ printed label.
	 */
	pageSequence?: string
	[key: string]: unknown
}

/** `<!-- part: {...} -->` — starts a contained work (article, chapter, section). */
export interface Part {
	key: string
	/** CSL type, or `none` / `advertisement` for content that is not a work. */
	type: CslType | 'none' | 'advertisement'
	/** CSL `genre`: the publication's own category (e.g. Notis, Bokanmälan). */
	genre?: string
	title?: string
	subtitle?: string
	authors?: Person[]
	rights?: string
	/** Printed page range in PageSequence syntax (`12-17`, `iv-vi`), as in the TOC `Sid(or)`. */
	pages?: string
	[key: string]: unknown
}

/** `<!-- figure: {...} -->` — describes the image directly above it. */
export interface Figure {
	/**
	 * Stable identity, same style as part keys: `<unit>|<printed page(s)>|<n-th figure on that
	 * page>`, e.g. `1987-2|5|1`, `1987-2|16-17|1`. Survives re-cropping (the image path changes,
	 * the key does not), so other content can reference the figure. Never renumber.
	 */
	key: string
	kind?: string
	caption?: string
	creators?: Person[]
	license?: string
	[key: string]: unknown
}

/** `<!-- note: {...} -->` — editorial apparatus anchored at its position in the text. */
export interface Note {
	type: 'transcription' | 'editorial'
	text: string
}

/** Image region in IIIF `pct:` form: percentages of the page, origin top-left. */
export interface Region {
	x: number
	y: number
	w: number
	h: number
}

export interface ImageRef {
	pageIndex: number
	region: Region
}

/** Position of a block in a page file (1-based line). */
export interface Loc {
	file: string
	line: number
}

export type Block =
	/** `<!-- page: <label> -->` — where the printed page with this label starts. */
	| { kind: 'page'; label: string; loc: Loc }
	/** Old `<!-- page N -->` spelling; only recognised to report it. */
	| { kind: 'legacy-page'; label: string; loc: Loc }
	| { kind: 'part'; value: unknown; loc: Loc }
	| { kind: 'figure'; value: unknown; loc: Loc }
	| { kind: 'note'; value: unknown; loc: Loc }
	| { kind: 'image'; alt: string; src: string; ref: ImageRef | null; loc: Loc }
	| { kind: 'unknown-comment'; raw: string; loc: Loc }
	| { kind: 'yaml-error'; block: 'page' | 'part' | 'figure' | 'note'; message: string; loc: Loc }

export interface Problem {
	level: 'error' | 'warning'
	file: string
	line?: number
	message: string
}
