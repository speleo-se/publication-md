#!/usr/bin/env node
/**
 * Write the image files referenced as ![…](img/pNNN_pct-x,y,w,h.jpg) in a unit's pages,
 * from the unit's source PDF. This is the reference implementation of the image
 * endpoint: both call extractRegionImage() from the vendored publication-md library.
 *
 *   node tools/scripts/extract-images.ts 2007-1           # missing images only
 *   node tools/scripts/extract-images.ts 2007-1 --force   # re-extract everything
 *
 * The PDF is publication.md `source.file`, else `<unit without -content>.pdf`, looked up
 * beside the unit folder. Output: <unit>/img/ (gitignored; regenerate any time).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { extractRegionImage, parseBlocks, parseFrontmatter } from '../lib/src/index.ts'
import { findUnits, readUnit, workspaceFromArgs } from './units.ts'

const args = process.argv.slice(2)
const ws = workspaceFromArgs(args)
const ROOT = ws.contentRoot
const force = args.includes('--force')
const tokens = args.filter((a) => !a.startsWith('--'))
if (!tokens.length) {
	console.error('usage: extract-images.ts <unit…> [--force]')
	process.exit(2)
}

const library = await PDFiumLibrary.init()
let failed = 0
for (const name of findUnits(ws, tokens)) {
	const unit = readUnit(ws, name)
	const fm = unit.publication ? parseFrontmatter(unit.publication) : null
	const source = (fm?.data as { source?: { file?: string } } | undefined)?.source?.file
	const pdfPath = join(ROOT, source ?? `${basename(name).replace(/-content$/, '')}.pdf`)

	const refs = new Map<string, { pageIndex: number; region: { x: number; y: number; w: number; h: number } }>()
	for (const page of unit.pages) {
		for (const b of parseBlocks(page.text, page.name)) {
			if (b.kind === 'image' && b.ref && b.src.startsWith('img/')) refs.set(b.src, b.ref)
		}
	}
	const todo = [...refs].filter(([src]) => force || !existsSync(resolve(ROOT, name, src)))
	console.log(`${name}: ${refs.size} image ref(s), ${todo.length} to extract`)
	if (!todo.length) continue
	if (!existsSync(pdfPath)) {
		console.error(`  missing source PDF ${pdfPath}`)
		failed++
		continue
	}
	const pdf = new Uint8Array(readFileSync(pdfPath))
	mkdirSync(resolve(ROOT, name, 'img'), { recursive: true })
	for (const [src, ref] of todo) {
		try {
			const img = await extractRegionImage(library, pdf, ref.pageIndex, ref.region)
			writeFileSync(resolve(ROOT, name, src), img.bytes)
			console.log(`  ${src}  ${img.width}×${img.height}  ${img.source}`)
		} catch (e) {
			console.error(`  ${src}: ${e instanceof Error ? e.message : e}`)
			failed++
		}
	}
}
library.destroy()
process.exit(failed ? 1 : 0)
