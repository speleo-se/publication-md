/**
 * Shared helpers for the tools: find unit folders of the active content repo, read them, and
 * load the repo-wide context (people.yaml, collections/).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
	applyNav,
	buildCorpus,
	type Context,
	type Corpus,
	NAV_LABELS,
	type NavPosition,
	navLines,
	type Problem,
	applyToc,
	applyCorrections,
	type TocCorrection,
	parseBlocks,
	tocBlock,
	parseFrontmatter,
	parsePeople,
	type UnitInput,
} from '../lib/src/index.ts'
import { loadWorkspace, takeContentArg, type Workspace } from './workspace.ts'

/** Resolve the workspace from argv (consumes `--content <name>`). */
export function workspaceFromArgs(argv: string[]): Workspace {
	try {
		return loadWorkspace(takeContentArg(argv))
	} catch (e) {
		// A clear message (e.g. "run: npm run content -- upgrade"), not a stack trace.
		console.error(e instanceof Error ? e.message : e)
		process.exit(1)
	}
}

const RE_PAGE = /^pageIndex-\d{3,}\.md$/
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory()

/**
 * All `*-content` unit folders of the content repo, or those whose name contains one of the
 * given tokens. A token that is an existing directory path is used as is.
 */
export function findUnits(ws: Workspace, tokens: string[]): string[] {
	const all = readdirSync(ws.contentRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory() && d.name.endsWith('-content'))
		.map((d) => d.name)
		.sort()
	if (!tokens.length) return all
	return tokens.map((t) => {
		if (t.includes('/') && isDir(resolve(t))) return resolve(t)
		const exact = all.find((n) => n === t || n === `${t}-content` || n === t.replace(/\/$/, ''))
		if (exact) return exact
		const hits = all.filter((n) => n.includes(t))
		if (hits.length !== 1) {
			throw new Error(hits.length ? `ambiguous "${t}": ${hits.join(', ')}` : `no unit matching "${t}"`)
		}
		return hits[0] as string
	})
}

/** Read a unit by folder name (under the content root) or absolute path. */
export function readUnit(ws: Workspace, nameOrPath: string): UnitInput {
	const dir = resolve(ws.contentRoot, nameOrPath)
	const name = basename(dir)
	const pages = readdirSync(dir)
		.filter((f) => RE_PAGE.test(f))
		.sort()
		.map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }))
	const pub = join(dir, 'publication.md')
	return existsSync(pub) ? { name, publication: readFileSync(pub, 'utf8'), pages } : { name, pages }
}

export function loadContext(ws: Workspace): { ctx: Context; problems: Problem[] } {
	const peopleFile = join(ws.contentRoot, 'people.yaml')
	const { index, problems } = existsSync(peopleFile)
		? parsePeople(readFileSync(peopleFile, 'utf8'))
		: { index: new Map<string, string>(), problems: [] as Problem[] }
	const colDir = join(ws.contentRoot, 'collections')
	const collections = new Set(
		existsSync(colDir)
			? readdirSync(colDir)
					.filter((f) => f.endsWith('.yaml'))
					.map((f) => f.slice(0, -'.yaml'.length))
			: [],
	)
	return { ctx: { people: index, collections }, problems }
}

/** Every unit of the content repo, indexed for cross-unit work (refs). */
export function readCorpus(ws: Workspace): Corpus {
	const inputs = findUnits(ws, []).map((folder) => {
		const u = readUnit(ws, folder)
		return u.publication === undefined
			? { folder, pages: u.pages }
			: { folder, publication: u.publication, pages: u.pages }
	})
	return buildCorpus(inputs, ws.config)
}

/** Where the content repo wants navigation lines (`nav.position`, default bottom). */
export const navPosition = (ws: Workspace): NavPosition => ws.config.nav?.position ?? 'bottom'

/**
 * The files of a unit as they should be with navigation lines and the table of contents in
 * `publication.md` (`npm run nav`): file name → text. Only the files whose text changes are returned.
 */
export function navUpdates(ws: Workspace, unit: UnitInput): Map<string, string> {
	let title = unit.name.replace(/-content$/, '')
	try {
		const t = (parseFrontmatter(unit.publication ?? '')?.data as Record<string, unknown> | undefined)?.title
		if (typeof t === 'string' && t) title = t
	} catch {
		// keep the folder name
	}
	const labels = ws.config.language === 'sv' ? NAV_LABELS.sv : NAV_LABELS.en
	const lines = navLines(unit, title, labels)
	const parts = unit.pages.flatMap((p) =>
		parseBlocks(p.text, p.name).flatMap((b) => (b.kind === 'part' ? [{ file: p.name, value: b.value }] : [])),
	)
	// Corrections of printed TOC rows that link to this unit's parts (first printed page of each part).
	let local = ''
	try {
		const id = (parseFrontmatter(unit.publication ?? '')?.data as Record<string, unknown> | undefined)?.id
		if (typeof id === 'string') local = id.replace(/^[^-]+-/, '')
	} catch {
		// no id: no corrections
	}
	const ns = Object.entries(ws.config.refs ?? {}).find(([, v]) => v?.units)?.[0]
	const starts = new Map<string, string>()
	for (const { value: v } of parts) {
		if (typeof v !== 'object' || v === null || Array.isArray(v)) continue
		const o = v as Record<string, unknown>
		if (o.continued === true || typeof o.key !== 'string' || o.pages === undefined) continue
		const first = String(o.pages).split(/\s*[-–,]\s*/)[0]?.trim()
		if (first) starts.set(o.key.slice(o.key.indexOf('|') + 1).replace(/\|/g, '~'), first)
	}
	const corrections: TocCorrection[] = []
	const out = new Map<string, string>()
	for (const p of unit.pages) {
		let text = p.text
		if (ns && local) {
			const r = applyCorrections(text, ns, local, starts, labels.corrected, p.name)
			text = r.text
			corrections.push(...r.corrections)
		}
		const want = applyNav(text, lines.get(p.name) ?? null, navPosition(ws))
		if (want !== p.text) out.set(p.name, want)
	}
	if (unit.publication !== undefined) {
		const where = ws.config.nav?.toc ?? 'bottom'
		const want = applyToc(unit.publication, where === 'none' ? null : tocBlock(unit, parts, labels, corrections), where)
		if (want !== unit.publication) out.set('publication.md', want)
	}
	return out
}
