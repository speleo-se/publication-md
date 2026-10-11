#!/usr/bin/env node
/**
 * Download the source PDFs of the active content repo, as configured in its
 * publication-md.yaml `sources` (tried in order, filtered by `years`).
 *
 *   node tools/fetch-sources.ts <unit…> [--dry-run] [--content <name>]
 *   node tools/fetch-sources.ts --missing            # every unit folder whose PDF is absent
 *
 * gdrive sources use the glotlabs `gdrive` CLI (authenticate once: `gdrive account add`;
 * binary overridable with GDRIVE_BIN). http sources fetch `<base>/<unit>.pdf`.
 * PDFs land beside the unit folders (`<content>/<unit>.pdf`, gitignored there).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Source, sourceCovers, unitInfo } from '../lib/src/index.ts'
import { findUnits, workspaceFromArgs } from './units.ts'

const GDRIVE = process.env['GDRIVE_BIN'] ?? 'gdrive'
const argv = process.argv.slice(2)
const ws = workspaceFromArgs(argv)
const dryRun = argv.includes('--dry-run')
const missing = argv.includes('--missing')
const tokens = argv.filter((a) => !a.startsWith('--'))
if (!tokens.length && !missing) {
	console.error('usage: fetch-sources.ts <unit…> | --missing  [--dry-run] [--content <name>]')
	process.exit(2)
}
const sources = ws.config.sources ?? []
if (!sources.length) {
	console.error(`${ws.name}: publication-md.yaml has no sources`)
	process.exit(1)
}

const listings = new Map<string, Map<string, string>>()
function gdriveList(folder: string): Map<string, string> {
	const cached = listings.get(folder)
	if (cached) return cached
	const args = ['files', 'list', '--query', `'${folder}' in parents and trashed = false`, '--max', '1000', '--skip-header', '--full-name', '--field-separator', ';']
	console.log(`  $ ${GDRIVE} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`)
	const r = spawnSync(GDRIVE, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
	if (r.error || r.status !== 0) throw new Error(`gdrive list failed (${folder}): ${(r.stderr || r.error?.message || '').trim()} — is gdrive installed and authenticated (gdrive account add)?`)
	const map = new Map<string, string>()
	for (const line of r.stdout.split('\n')) {
		const [id, name] = line.split(';')
		if (id && name) map.set(name, id)
	}
	listings.set(folder, map)
	return map
}

async function fetchFrom(source: Source, unit: string, dest: string): Promise<boolean> {
	const file = `${unit}.pdf`
	if (source.type === 'gdrive') {
		const id = gdriveList(source.folder).get(file)
		if (!id) return false
		console.log(`  gdrive ${source.folder}: ${file} (${id})`)
		if (dryRun) return true
		const tmp = mkdtempSync(join(tmpdir(), 'pmd-fetch-'))
		try {
			const r = spawnSync(GDRIVE, ['files', 'download', '--destination', tmp, '--overwrite', id], { encoding: 'utf8' })
			if (r.status !== 0) throw new Error(`gdrive download failed: ${(r.stderr || '').trim()}`)
			renameSync(join(tmp, file), dest)
		} finally {
			rmSync(tmp, { recursive: true, force: true })
		}
		return true
	}
	const url = `${source.base.replace(/\/$/, '')}/${encodeURIComponent(file)}`
	console.log(`  http ${url}`)
	if (dryRun) return true
	const res = await fetch(url)
	if (!res.ok) return false
	writeFileSync(dest, new Uint8Array(await res.arrayBuffer()))
	return true
}

const units = missing
	? readdirSync(ws.contentRoot)
			.filter((d) => d.endsWith('-content'))
			.map((d) => d.replace(/-content$/, ''))
			.filter((u) => !existsSync(join(ws.contentRoot, `${u}.pdf`)))
	: findUnits(ws, tokens).map((d) => d.replace(/-content$/, ''))

let failed = 0
for (const unit of units) {
	const dest = join(ws.contentRoot, `${unit}.pdf`)
	if (existsSync(dest) && !dryRun) {
		console.log(`${unit}: already present`)
		continue
	}
	const year = unitInfo(ws.config, unit)?.year
	console.log(`${unit}${year ? ` (${year})` : ''}:`)
	let ok = false
	for (const s of sources.filter((s) => sourceCovers(s, year))) {
		try {
			if ((ok = await fetchFrom(s, unit, dest))) break
		} catch (e) {
			console.log(`  ${e instanceof Error ? e.message : e}`)
		}
	}
	if (!ok) {
		console.log('  not found in any configured source')
		failed++
	} else if (!dryRun) console.log(`  -> ${dest}`)
}
process.exit(failed ? 1 : 0)
