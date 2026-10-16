#!/usr/bin/env node
/**
 * Validate units against the publication-md format (schema/README.md).
 *
 *   node tools/scripts/validate.ts                      # every *-content folder
 *   node tools/scripts/validate.ts 2007-1 1987_2        # selected units (name or unique substring)
 *   node tools/scripts/validate.ts --errors-only 2007-1 # hide warnings
 *
 * Acts on the active content repo (`--content <name>` to pick another). Exit code 1 on errors.
 */
import { basename } from 'node:path'
import { collectRefs, validateUnit } from '../lib/src/index.ts'
import { findUnits, loadContext, navUpdates, readCorpus, readUnit, workspaceFromArgs } from './units.ts'

const args = process.argv.slice(2)
const ws = workspaceFromArgs(args)
const errorsOnly = args.includes('--errors-only')
const tokens = args.filter((a) => !a.startsWith('--'))

const { ctx, problems: ctxProblems } = loadContext(ws)
let errors = 0
let warnings = 0
const report = (unit: string, p: { level: string; file: string; line?: number; message: string }) => {
	if (p.level === 'error') errors++
	else warnings++
	if (errorsOnly && p.level !== 'error') return
	const at = p.line ? `${p.file}:${p.line}` : p.file
	console.log(`${p.level === 'error' ? 'ERROR' : 'warn '} ${unit}/${at}: ${p.message}`)
}
for (const p of ctxProblems) report('.', p)

const units = findUnits(ws, tokens)
for (const name of units) {
	const unit = readUnit(ws, name)
	for (const p of validateUnit(unit, ctx)) report(basename(name), p)
	const stale = navUpdates(ws, unit).size
	if (stale) report(basename(name), { level: 'warning', file: '.', message: `${stale} file(s) without current navigation lines / contents — run \`npm run nav\`` })
}
// References are checked against the whole corpus (targets may be in any unit); only the
// problems of the units being validated are reported.
const selected = new Set(units.map((u) => basename(u)))
for (const p of collectRefs(readCorpus(ws)).problems) {
	const [unit, ...rest] = p.file.split('/')
	if (unit && selected.has(unit)) report(unit, { ...p, file: rest.join('/') })
}
console.log(`\n${units.length} unit(s): ${errors} error(s), ${warnings} warning(s)`)
process.exit(errors ? 1 : 0)
