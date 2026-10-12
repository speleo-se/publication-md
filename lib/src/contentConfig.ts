import { parse as parseYaml } from 'yaml'
import { compareVersions } from './migrations.ts'
import { CURRENT_VERSION, type Problem } from './types.ts'

/**
 * `publication-md.yaml` at the root of a content repo: who owns the content, how its
 * units are named, where the source PDFs live, and which content-specific rules apply.
 * See spec/content-repo.md.
 */
export const CONTENT_CONFIG = `publication-md-content/${CURRENT_VERSION}` as const

export interface SourceGdrive {
	type: 'gdrive'
	folder: string
	/** Inclusive year range of the units in this folder: `1966-2006`, `2007-`. */
	years?: string
}
export interface SourceHttp {
	type: 'http'
	/** Base URL; the unit's PDF is fetched from `<base>/<unit>.pdf`. */
	base: string
	years?: string
}
export type Source = SourceGdrive | SourceHttp

/**
 * A unit-name pattern: a regex string, or `{pattern, id}` when units matching it need their own
 * id template (e.g. issues numbered by volume rather than year).
 */
export type UnitPattern = string | { pattern: string; id?: string }
const patternOf = (p: UnitPattern) => (typeof p === 'string' ? p : p.pattern)

export interface ContentConfig {
	config: typeof CONTENT_CONFIG
	/** Short machine name, also the folder name under the workspace's content/. */
	name: string
	title?: string
	owner?: string
	copyright?: string
	license?: string
	language?: string
	units: {
		/** Unit name glob (without `-content`), e.g. `SSF_Grottan_*_webb`. */
		glob: string
		/**
		 * Regexes (JS syntax, named groups) tried in order; groups `year`, `issue`, `volume`
		 * drive sorting and display. The first match wins.
		 */
		patterns?: UnitPattern[]
		/**
		 * Template for every unit's id (= `publication.md` `id`), filled from the pattern groups:
		 * `grottan-{year}-{issue}`. Lets references target units that have no publication.md yet.
		 */
		id?: string
	}
	sources?: Source[]
	/** Folder (relative to the content repo) with content-specific skill rules. Default `rules`. */
	rules?: string
	/**
	 * Reference namespaces (`ref/<ns>/…`). `units: true` marks a namespace of publication units —
	 * this repo's own (`ref/grottan/1982-4.md` ↔ unit id `grottan-1982-4`); the others are entity
	 * namespaces (`ref/ssf/933.md`), optionally with a URL template (`{id}`) to the authority.
	 */
	refs?: Record<string, { title?: string; url?: string; units?: boolean }>
	/**
	 * Google OAuth client ("Desktop app") for gdrive sources: users log in with
	 * `npm run fetch -- login`. A desktop client's secret is not confidential and may be committed.
	 */
	google?: { clientId: string; clientSecret?: string }
	/** Options for the transcription tooling, e.g. `noteLabel`, `alphabet`. */
	transcribe?: Record<string, unknown>
	[key: string]: unknown
}

/**
 * Message for a version mismatch: an older (or other) known version gets an upgrade hint,
 * anything else the plain expectation.
 */
export function versionMessage(field: string, prefix: string, value: unknown): string {
	const want = `${prefix}/${CURRENT_VERSION}`
	const m = typeof value === 'string' ? new RegExp(`^${prefix}/(\\d+(?:\\.\\d+)*)$`).exec(value) : null
	if (!m) return `${field} must be "${want}"`
	const v = m[1] ?? ''
	return compareVersions(v, CURRENT_VERSION) > 0
		? `content is ${prefix} ${v}, newer than these tools (${CURRENT_VERSION}) — update publication-md`
		: `content is ${prefix} ${v}, these tools are ${CURRENT_VERSION} — run: npm run content -- upgrade (or use publication-md ${v})`
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v)

const RE_NAME = /^[a-z0-9][a-z0-9._-]*$/
const RE_YEARS = /^\d{4}-(\d{4})?$|^\d{4}$/

export function parseContentConfig(text: string): { config: ContentConfig | null; problems: Problem[] } {
	const file = 'publication-md.yaml'
	const problems: Problem[] = []
	const err = (message: string) => problems.push({ level: 'error', file, message })
	let d: unknown
	try {
		d = parseYaml(text)
	} catch (e) {
		err(`invalid YAML: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
		return { config: null, problems }
	}
	if (!isObj(d)) {
		err('must be a mapping')
		return { config: null, problems }
	}
	if (d.config !== CONTENT_CONFIG) err(versionMessage('config', 'publication-md-content', d.config))
	if (typeof d.name !== 'string' || !RE_NAME.test(d.name)) err('name: required, [a-z0-9._-]')
	if (!isObj(d.units) || typeof d.units.glob !== 'string' || !d.units.glob) err('units.glob: required')
	else if (d.units.patterns !== undefined) {
		if (!Array.isArray(d.units.patterns)) err('units.patterns must be a list')
		else
			for (const p of d.units.patterns) {
				const re = isObj(p) ? p.pattern : p
				if (isObj(p) && p.id !== undefined && typeof p.id !== 'string') err('units.patterns[].id must be a string')
				try {
					new RegExp(String(re))
				} catch {
					err(`units.patterns: invalid regex ${JSON.stringify(re)}`)
				}
			}
	}
	if (d.sources !== undefined) {
		if (!Array.isArray(d.sources)) err('sources must be a list')
		else
			for (const [i, s] of d.sources.entries()) {
				if (!isObj(s)) err(`sources[${i}] must be a mapping`)
				else if (s.type === 'gdrive' && typeof s.folder !== 'string') err(`sources[${i}].folder: required`)
				else if (s.type === 'http' && typeof s.base !== 'string') err(`sources[${i}].base: required`)
				else if (s.type !== 'gdrive' && s.type !== 'http') err(`sources[${i}].type: gdrive or http`)
				if (isObj(s) && s.years !== undefined && !RE_YEARS.test(String(s.years))) {
					err(`sources[${i}].years: YYYY, YYYY-YYYY or YYYY-`)
				}
			}
	}
	if (d.google !== undefined) {
		const g = d.google
		if (!isObj(g) || typeof g.clientId !== 'string' || !g.clientId.endsWith('.apps.googleusercontent.com')) {
			err('google.clientId must be an OAuth client id (….apps.googleusercontent.com)')
		} else if (g.clientSecret !== undefined && typeof g.clientSecret !== 'string') err('google.clientSecret must be a string')
	}
	if (d.refs !== undefined) {
		if (!isObj(d.refs)) err('refs must map namespace → {title, url}')
		else
			for (const [ns, v] of Object.entries(d.refs)) {
				if (!/^[a-z][a-z0-9-]*$/.test(ns)) err(`refs: namespace "${ns}" must be [a-z][a-z0-9-]*`)
				if (v !== null && !isObj(v)) err(`refs.${ns} must be a mapping`)
				else if (isObj(v) && v.url !== undefined && !String(v.url).includes('{id}')) err(`refs.${ns}.url needs {id}`)
			}
	}
	return { config: problems.length ? null : (d as ContentConfig), problems }
}

/** Glob (`*`, `?`) → anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
	const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
	return new RegExp(`^${re}$`)
}

export interface UnitInfo {
	name: string
	year?: number
	issue?: string
	volume?: string
	/** Sort tuple: year, first number of the issue, name. Unparsed names sort last. */
	sortKey: [number, number, string]
}

/** Parse a unit name with the config's patterns. Returns null when it doesn't match `units.glob`. */
export function unitInfo(config: Pick<ContentConfig, 'units'>, name: string): UnitInfo | null {
	if (!globToRegExp(config.units.glob).test(name)) return null
	for (const p of config.units.patterns ?? []) {
		const g = new RegExp(patternOf(p)).exec(name)?.groups
		if (!g) continue
		const year = g.year ? Number(g.year) : undefined
		const issueNo = g.issue ? Number(g.issue.split('-')[0]) : 99
		const info: UnitInfo = { name, sortKey: [year ?? 9999, issueNo, name] }
		if (year !== undefined) info.year = year
		if (g.issue) info.issue = g.issue
		if (g.volume) info.volume = g.volume
		return info
	}
	return { name, sortKey: [9999, 99, name] }
}

export function compareUnits(a: UnitInfo, b: UnitInfo): number {
	return a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

/**
 * A unit's id: the matching pattern's own `id` template, else `units.id`, filled from the name's
 * pattern groups; the name itself when there is no template.
 */
export function unitId(config: Pick<ContentConfig, 'units'>, name: string): string {
	for (const p of config.units.patterns ?? []) {
		const g = new RegExp(patternOf(p)).exec(name)?.groups
		if (!g) continue
		const tpl = (typeof p === 'string' ? undefined : p.id) ?? config.units.id
		if (!tpl) return name
		let missing = false
		const id = tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
			const v = g[k]
			if (v === undefined) missing = true
			return v ?? ''
		})
		return missing ? name : id
	}
	return name
}

/** Whether a source covers a unit's year (a source without `years` covers everything). */
export function sourceCovers(source: Source, year: number | undefined): boolean {
	if (!source.years || year === undefined) return true
	const [from, to] = String(source.years).split('-')
	return year >= Number(from) && (to === undefined ? Number(from) === year : to === '' || year <= Number(to))
}
