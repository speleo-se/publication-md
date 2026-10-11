import { describe, expect, it } from 'vitest'
import { formatImagePath, iou, parseImagePath } from './imagePath.ts'
import { parseBlocks, stripComments } from './parse.ts'
import { collectParts, parsePeople, validateUnit } from './validate.ts'

const PUBLICATION = `---
format: publication-md/1
id: grottan-2007-1
type: periodical
title: Grottan 2007:1
issued: 2007-03
container: {type: periodical, id: grottan}
volume: 42
issue: 1
source: {file: SSF_Grottan_2007-1_webb.pdf, kind: digital}
---
`

const PAGE = `<!-- page: 6 -->

<!-- part: {key: "2007-1|6|1", type: article-magazine, title: Från redaktionen, authors: [Sven Gunnvall]} -->
# Från Redaktionen

Text.
![Omslagsbild](img/p003_pct-8,31,84,43.jpg)
<!-- figure: {key: "2007-1|6|1", kind: photo, creators: [{name: Anna Svensson, role: photographer}]} -->

<!-- note: {type: transcription, text: "Tabellen är i två spalter i trycket."} -->

<!-- part: none -->
Annons.
`

describe('imagePath', () => {
	it('round-trips', () => {
		const ref = { pageIndex: 12, region: { x: 8, y: 31.5, w: 84, h: 43.25 } }
		const path = formatImagePath(ref)
		expect(path).toBe('img/p012_pct-8,31.5,84,43.25.jpg')
		expect(parseImagePath(path)).toEqual(ref)
		expect(parseImagePath('../x/img/p012_pct-8,31.5,84,43.25.jpg')).toEqual(ref)
	})
	it('rejects out-of-page and malformed regions', () => {
		expect(parseImagePath('img/p012_pct-50,0,60,10.jpg')).toBeNull()
		expect(parseImagePath('img/p12_pct-0,0,10,10.jpg')).toBeNull()
		expect(parseImagePath('img/p012_pct-0,0,0,10.jpg')).toBeNull()
	})
	it('iou', () => {
		expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(1)
		expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(0)
	})
})

describe('parse', () => {
	it('finds blocks in order with lines', () => {
		const kinds = parseBlocks(PAGE, 'pageIndex-003.md').map((b) => `${b.kind}@${b.loc.line}`)
		expect(kinds).toEqual(['page@1', 'part@3', 'image@7', 'figure@8', 'note@10', 'part@12'])
	})
	it('strips comments for reading text', () => {
		expect(stripComments(PAGE)).not.toContain('<!--')
		expect(stripComments(PAGE)).toContain('# Från Redaktionen')
	})
})

describe('validateUnit', () => {
	const people = parsePeople(
		'- name: Sven Gunnvall\n- name: Anna Svensson\n  aliases: [A. Svensson]\n',
	).index

	it('accepts a well-formed unit', () => {
		const problems = validateUnit(
			{ name: 'u', publication: PUBLICATION, pages: [{ name: 'pageIndex-003.md', text: PAGE }] },
			{ people, collections: new Set(['grottan']) },
		)
		expect(problems).toEqual([])
	})

	it('accepts legacy pages with no metadata at all', () => {
		expect(
			validateUnit({ name: 'u', pages: [{ name: 'p.md', text: '<!-- page: 3 -->\n# Rubrik\n' }] }),
		).toEqual([])
	})

	it('reports broken metadata', () => {
		const bad = [
			'<!-- Handskriven not -->',
			'<!-- part: {key: a, type: chapter} -->',
			'<!-- part: {key: a, type: chapter, titel: x} -->',
			'<!-- figure: {id: f1} -->',
			'![x](img/p1_pct-1,1,1,1.jpg)',
			'<!-- note: {type: misc} -->',
			'<!-- part: {key: [unclosed -->',
			'<!-- page: 9 -->',
			'<!-- page: 8 -->',
			'<!-- page 10 -->',
		].join('\n\n')
		const msgs = validateUnit(
			{
				name: 'u',
				publication: '---\nformat: x\nid: a\ntype: book\nissued: 1987-5\n---\n',
				pages: [{ name: 'p.md', text: bad }],
			},
			{ people, collections: new Set() },
		).map((p) => `${p.level}:${p.message}`)
		const expectHit = (s: string) =>
			expect(
				msgs.some((m) => m.includes(s)),
				s,
			).toBe(true)
		expectHit('format must be')
		expectHit('issued must be')
		expectHit('unknown comment')
		expectHit('already used')
		expectHit('warning:part: unknown key "titel"')
		expectHit('figure must directly follow')
		expectHit('figure.id is now figure.key')
		expectHit('is not img/pNNN')
		expectHit('note.type')
		expectHit('invalid YAML')
		expectHit('out of order')
		expectHit('write <!-- page: 10 -->')
	})

	it('warns about people missing from people.yaml, accepts aliases', () => {
		const page = '<!-- part: {key: k, type: chapter, authors: [A. Svensson, Okänd Person]} -->'
		const msgs = validateUnit({ name: 'u', pages: [{ name: 'p.md', text: page }] }, { people })
		expect(msgs).toEqual([
			{
				level: 'warning',
				file: 'p.md',
				line: 1,
				message: 'part.authors: "Okänd Person" is not in people.yaml',
			},
		])
	})
})

describe('pageSequence', () => {
	const pub = (seq: string) =>
		`---\nformat: publication-md/1\nid: u\ntype: periodical\npageSequence: "${seq}"\n---\n`
	const unit = (seq: string, pages: string[]) => ({
		name: 'u',
		publication: pub(seq),
		pages: pages.map((text, i) => ({ name: `pageIndex-${String(i).padStart(3, '0')}.md`, text })),
	})
	const msgs = (u: ReturnType<typeof unit>) => validateUnit(u).map((p) => `${p.file}: ${p.message}`)

	it('accepts spreads, labels, roman numerals, ignored duplicates and omitted single markers', () => {
		const u = unit('Omslag|ii,1-2|3,!3,iv', [
			'<!-- page: Omslag -->\nA\n<!-- page: ii -->\nB',
			'Ett.',
			'<!-- page: 2 -->\nTvå <!-- page: 3 --> tre.',
			'Dubblett av sidan 3, utan markör.',
			'<!-- page: IV -->\nFyra.',
		])
		expect(msgs(u)).toEqual([])
	})
	it('rejects missing spread markers, wrong labels, markers on ignored pages, bad counts', () => {
		expect(msgs(unit('1-2|3', ['<!-- page: 1 -->', '<!-- page: 2 -->']))).toEqual([
			'pageIndex-001.md: page markers ["2"] ≠ pageSequence labels ["2","3"] for pageIndex 1',
		])
		expect(msgs(unit('1-2', ['<!-- page: 1 -->', '<!-- page: 3 -->']))[0]).toContain(
			'≠ pageSequence labels ["2"]',
		)
		expect(msgs(unit('1,!1', ['x', '<!-- page: 1 -->']))[0]).toContain('labels [] for pageIndex 1')
		expect(msgs(unit('1-3', ['a', 'b']))[0]).toMatch(/^publication\.md: pageSequence: /)
	})
	it('warns when a part/figure key names pages outside the sequence', () => {
		const u = unit('1-4', [
			'<!-- part: {key: "x|2-3|1", type: chapter} -->\n![a](img/p000_pct-0,0,10,10.jpg)\n<!-- figure: {key: "x|9|1"} -->',
			'',
			'',
			'',
		])
		expect(msgs(u)).toEqual(['pageIndex-000.md: figure.key "x|9|1": pages "9" not in pageSequence'])
	})
	it('resolves part.pages through the sequence', () => {
		const ok = unit('1-4', ['<!-- part: {key: k, type: chapter, pages: 2-3} -->', '', '', ''])
		expect(msgs(ok)).toEqual([])
		const bad = unit('1-4', ['<!-- part: {key: k, type: chapter, pages: 5-6} -->', '', '', ''])
		expect(msgs(bad)).toEqual(['pageIndex-000.md: part.pages "5-6" does not resolve in pageSequence'])
	})
})

describe('collectParts', () => {
	it('splits across page boundaries', () => {
		const parts = collectParts([
			{ name: 'a.md', text: 'Före.\n<!-- part: {key: k1, type: chapter} -->\nEtt.\n' },
			{ name: 'b.md', text: 'Fortsättning.\n<!-- part: {key: k2, type: chapter} -->\nTvå.\n' },
		])
		expect(parts.map((p) => [(p.part as { key?: string } | null)?.key ?? null, p.pages])).toEqual([
			[null, ['a.md']],
			['k1', ['a.md', 'b.md']],
			['k2', ['b.md']],
		])
		expect(parts[1]?.text).toContain('Fortsättning.')
	})
	it('resumes a continued part after an interruption', () => {
		const pages = [
			{
				name: 'pageIndex-000.md',
				text:
					'<!-- part: {key: a, type: review-book} -->\nRecension.\n<!-- part: {key: b, type: article-magazine} -->\nNotis.\n',
			},
			{ name: 'pageIndex-001.md', text: '<!-- part: {key: a, continued: true} -->\nPlansch.\n' },
		]
		const parts = collectParts(pages)
		expect(parts.map((p) => [(p.part as { key: string }).key, p.pages])).toEqual([
			['a', ['pageIndex-000.md', 'pageIndex-001.md']],
			['b', ['pageIndex-000.md']],
		])
		expect(parts[0]?.text).toContain('Plansch.')
		expect(validateUnit({ name: 'u', pages })).toEqual([])
		const bad = validateUnit({
			name: 'u',
			pages: [{ name: 'p.md', text: '<!-- part: {key: x, continued: true, title: t} -->' }],
		})
		expect(bad.map((p) => p.message)).toEqual([
			'part continues unknown key "x" (must be declared earlier)',
			'part continuation takes only key and continued, not "title"',
		])
	})
})

describe('JSON Schema agrees with the validator', async () => {
	const { default: Ajv } = await import('ajv/dist/2020.js')
	const { readFileSync } = await import('node:fs')
	const { parse } = await import('yaml')
	const schema = JSON.parse(
		readFileSync(new URL('../../spec/publication-md.schema.json', import.meta.url), 'utf8'),
	)
	const ajv = new Ajv({ strict: false })
	ajv.addSchema(schema)
	const check = (def: string, v: unknown) => ajv.validate(`${schema.$id}#/$defs/${def}`, v)

	it('accepts the sample metadata', () => {
		expect(check('publication', parse(PUBLICATION.split('---')[1] ?? ''))).toBe(true)
		for (const b of parseBlocks(PAGE, 'p.md')) {
			if (b.kind === 'part' || b.kind === 'figure' || b.kind === 'note')
				expect(check(b.kind, b.value), b.kind).toBe(true)
			if (b.kind === 'image') expect(check('imagePath', b.src)).toBe(true)
		}
	})
	it('rejects what the validator rejects', () => {
		expect(check('publication', { format: 'x', id: 'a', type: 'book' })).toBe(false)
		expect(check('note', { type: 'misc', text: 'x' })).toBe(false)
		expect(check('part', { key: 'a' })).toBe(false)
		expect(check('imagePath', 'img/p1_pct-1,1,1,1.jpg')).toBe(false)
		expect(check('page', '')).toBe(false)
	})
})
