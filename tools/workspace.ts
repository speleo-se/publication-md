#!/usr/bin/env node
/**
 * The publication-md workspace: content repos live (cloned or symlinked) under content/<name>,
 * their render trees under work/<name>. One of them is active (content/.active).
 *
 * Every tool and skill resolves paths through here, so they all agree on which content repo
 * they act on. Selection, highest first: `--content <name>` → PMD_CONTENT → content/.active →
 * the only repo under content/.
 *
 *   node tools/workspace.ts --json [--content <name>]   # used by the Python skill scripts
 *
 * Overrides: PMD_CONTENT_ROOT / PMD_WORK_ROOT (legacy GROTTAN_CONTENT_ROOT / GROTTAN_WORK_ROOT).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ContentConfig, parseContentConfig } from '../lib/src/index.ts'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CONTENT_DIR = join(ROOT, 'content')
export const WORK_DIR = join(ROOT, 'work')
const ACTIVE = join(CONTENT_DIR, '.active')

/** Remove `--content <name>` from argv and return it. */
export function takeContentArg(argv: string[]): string | undefined {
	const i = argv.indexOf('--content')
	if (i < 0) return undefined
	const v = argv[i + 1]
	argv.splice(i, 2)
	return v
}

export function listContent(): string[] {
	if (!existsSync(CONTENT_DIR)) return []
	return readdirSync(CONTENT_DIR, { withFileTypes: true })
		.filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.isSymbolicLink()))
		.map((d) => d.name)
		.sort()
}

export function activeName(explicit?: string): string {
	const name =
		explicit ??
		process.env['PMD_CONTENT'] ??
		(existsSync(ACTIVE) ? readFileSync(ACTIVE, 'utf8').trim() : undefined) ??
		(listContent().length === 1 ? listContent()[0] : undefined)
	if (!name) {
		throw new Error('no active content repo — add one: npm run content add <git-url|path>  (see README)')
	}
	return name
}

export interface Workspace {
	name: string
	contentRoot: string
	workRoot: string
	config: ContentConfig
}

export function loadWorkspace(explicit?: string): Workspace {
	const env = process.env
	const fixedRoot = env['PMD_CONTENT_ROOT'] ?? env['GROTTAN_CONTENT_ROOT']
	const name = fixedRoot && !explicit && !env['PMD_CONTENT'] ? '' : activeName(explicit)
	const contentRoot = resolve(fixedRoot ?? join(CONTENT_DIR, name))
	const cfgFile = join(contentRoot, 'publication-md.yaml')
	if (!existsSync(cfgFile)) throw new Error(`${contentRoot} has no publication-md.yaml (see spec/content-repo.md)`)
	const { config, problems } = parseContentConfig(readFileSync(cfgFile, 'utf8'))
	if (!config) throw new Error(`invalid ${cfgFile}:\n${problems.map((p) => `  ${p.message}`).join('\n')}`)
	const workRoot = resolve(env['PMD_WORK_ROOT'] ?? env['GROTTAN_WORK_ROOT'] ?? join(WORK_DIR, name || config.name))
	return { name: name || config.name, contentRoot, workRoot, config }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const argv = process.argv.slice(2)
	const explicit = takeContentArg(argv)
	try {
		const ws = loadWorkspace(explicit)
		console.log(argv.includes('--json') ? JSON.stringify(ws) : `${ws.name}\n  content: ${ws.contentRoot}\n  work:    ${ws.workRoot}`)
	} catch (e) {
		console.error(e instanceof Error ? e.message : e)
		process.exit(1)
	}
}
