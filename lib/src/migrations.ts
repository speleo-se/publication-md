import { CURRENT_VERSION } from './types.ts'

/**
 * Version upgrades of a content repo (`npm run content -- upgrade`). A migration is a pure
 * function over the repo's text files, so it is deterministic, testable and runs without Claude.
 *
 * Adding an incompatible change: bump CURRENT_VERSION and append one migration from the
 * previous version, e.g. `{ from: '0.1', to: '0.2', describe: '…', migrate: (files) => … }`.
 * `bumpVersion` (config, every publication.md, the workflow pin) runs after each step.
 */

/** Repo-relative path → file text. */
export type FileMap = Map<string, string>

export interface Migration {
	from: string
	to: string
	describe: string
	migrate(files: FileMap): FileMap
}

/** The real migrations, oldest first. Empty while 0.1 is the only version. */
export const MIGRATIONS: Migration[] = []

const RE_CONFIG = /^config:\s*publication-md-content\/(\S+)\s*$/m

/** The version a content repo's publication-md.yaml declares, or null. */
export function versionOf(configText: string): string | null {
	return RE_CONFIG.exec(configText)?.[1] ?? null
}

/** Numeric comparison of dotted versions (`0.10` > `0.9`). */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (d) return d
	}
	return 0
}

/** The chain of migrations from `from` to `to`; throws when there is no path. */
export function planUpgrade(from: string, to = CURRENT_VERSION, migrations = MIGRATIONS): Migration[] {
	const chain: Migration[] = []
	let v = from
	while (v !== to) {
		const step = migrations.find((m) => m.from === v)
		if (!step) {
			throw new Error(
				compareVersions(v, to) > 0
					? `content is version ${v}, newer than these tools (${to}) — update publication-md`
					: `no upgrade path from version ${v} to ${to} — use publication-md ${v}, or migrate by hand`,
			)
		}
		chain.push(step)
		v = step.to
		if (chain.length > migrations.length) throw new Error(`migration loop at ${v}`)
	}
	return chain
}

/** Rewrite every version marker to `to`: config, publication.md formats, the workflow pin. */
export function bumpVersion(files: FileMap, to: string): FileMap {
	const out = new Map(files)
	for (const [path, text] of files) {
		let t = text
		if (path === 'publication-md.yaml') t = t.replace(RE_CONFIG, `config: publication-md-content/${to}`)
		else if (/(^|\/)publication\.md$/.test(path)) t = t.replace(/^format:\s*publication-md\/\S+\s*$/m, `format: publication-md/${to}`)
		else if (path === '.github/workflows/publication-md.yml') {
			// Only a pinned version tag is moved; a branch pin (main) is left as it is.
			t = t
				.replace(/(content\.yml@)v\d+(?:\.\d+)*/g, `$1v${to}`)
				.replace(/(publication-md-ref:\s*)v\d+(?:\.\d+)*/g, `$1v${to}`)
		}
		if (t !== text) out.set(path, t)
	}
	return out
}

/** Run the chain; returns the new files and a description per step. */
export function upgradeFiles(
	files: FileMap,
	from: string,
	to = CURRENT_VERSION,
	migrations = MIGRATIONS,
): { files: FileMap; steps: string[] } {
	let cur = files
	const steps: string[] = []
	for (const m of planUpgrade(from, to, migrations)) {
		cur = bumpVersion(m.migrate(cur), m.to)
		steps.push(`${m.from} → ${m.to}: ${m.describe}`)
	}
	return { files: cur, steps }
}
