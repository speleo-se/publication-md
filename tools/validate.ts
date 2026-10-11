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
import { validateUnit } from '../lib/src/index.ts'
import { findUnits, loadContext, readUnit, workspaceFromArgs } from './units.ts'

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
	for (const p of validateUnit(readUnit(ws, name), ctx)) report(basename(name), p)
}
console.log(`\n${units.length} unit(s): ${errors} error(s), ${warnings} warning(s)`)
process.exit(errors ? 1 : 0)
