/**
 * Shared helpers for the tools: find unit folders of the active content repo, read them, and
 * load the repo-wide context (people.yaml, collections/).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { buildCorpus, type Context, type Corpus, type Problem, parsePeople, type UnitInput } from '../lib/src/index.ts'
import { loadWorkspace, takeContentArg, type Workspace } from './workspace.ts'

/** Resolve the workspace from argv (consumes `--content <name>`). */
export function workspaceFromArgs(argv: string[]): Workspace {
	return loadWorkspace(takeContentArg(argv))
}

const RE_PAGE = /^pageIndex-\d{3,}\.md$/
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory()

/**
 * All `*-content` unit folders of the content repo, or those whose name contains one of the
 * given tokens. A token that is an existing directory path (e.g. a work copy) is used as is.
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
