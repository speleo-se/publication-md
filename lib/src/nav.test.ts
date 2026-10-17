import { describe, expect, it } from 'vitest'
import { applyCorrections, joinLabels, applyNav, applyToc, stripCorrections, NAV_LABELS, navLines, stripNav, stripToc, tocBlock } from './nav.ts'
import { parseBlocks, stripComments } from './parse.ts'
import { validateUnit } from './validate.ts'

const LINE = '[⬅️ s. 1](pageIndex-000.md) <!-- nav: generated -->'

describe('navigation lines', () => {
	it('applies at each position and strips back to the original', () => {
		const page = '# Rubrik\n\nText.\n'
		expect(applyNav(page, LINE, 'bottom')).toBe(`# Rubrik\n\nText.\n\n${LINE}\n`)
		expect(applyNav(page, LINE, 'top')).toBe(`${LINE}\n\n# Rubrik\n\nText.\n`)
		expect(applyNav(page, LINE, 'both')).toBe(`${LINE}\n\n# Rubrik\n\nText.\n\n${LINE}\n`)
		expect(applyNav(page, LINE, 'none')).toBe(page)
		for (const pos of ['bottom', 'top', 'both'] as const) expect(stripNav(applyNav(page, LINE, pos))).toBe(page)
		// idempotent and movable
		expect(applyNav(applyNav(page, LINE, 'bottom'), LINE, 'bottom')).toBe(applyNav(page, LINE, 'bottom'))
		expect(applyNav(applyNav(page, LINE, 'both'), LINE, 'top')).toBe(applyNav(page, LINE, 'top'))
		expect(applyNav(applyNav(page, LINE, 'bottom'), null, 'none')).toBe(page)
		const last = '[⬅️ s. 3](pageIndex-002.md) · **s. 4** <!-- nav: generated -->'
		expect(stripNav(applyNav(page, last, 'bottom'))).toBe(page) // a last page ends in its bold label
	})
	it('joins a spread\'s labels as a range only when consecutive', () => {
		expect(joinLabels(['2', '3'])).toBe('2–3')
		expect(joinLabels(['20', '29'])).toBe('20,29')
		expect(joinLabels(['Omslag', '2'])).toBe('Omslag,2')
		expect(joinLabels(['iv', 'v'])).toBe('iv–v')
		expect(joinLabels(['iv', 'vi'])).toBe('iv,vi')
		expect(joinLabels(['7'])).toBe('7')
	})
	it('links neighbours by printed label (spreads as ranges, unlabelled pages by PDF number)', () => {
		const pub = '---\nformat: publication-md/0.1\nid: x\ntype: book\npageSequence: "1,2|3,!3,4"\n---\n'
		const pages = ['pageIndex-000.md', 'pageIndex-001.md', 'pageIndex-002.md', 'pageIndex-003.md'].map((name) => ({ name }))
		const l = navLines({ publication: pub, pages }, 'Boken', NAV_LABELS.sv)
		expect(l.get('pageIndex-000.md')).toBe('[📖 Boken](publication.md) · **s. 1**  │  [s. 2–3 ➡️](pageIndex-001.md) <!-- nav: generated -->')
		expect(l.get('pageIndex-001.md')).toBe(
			'[⬅️ s. 1](pageIndex-000.md)  │  [📖 Boken](publication.md) · **s. 2–3**  │  [PDF-sida 3 ➡️](pageIndex-002.md) <!-- nav: generated -->',
		)
		expect(l.get('pageIndex-003.md')).toBe('[⬅️ PDF-sida 3](pageIndex-002.md)  │  [📖 Boken](publication.md) · **s. 4** <!-- nav: generated -->')
	})
	it('is parsed as a block, removed from the reading text, and must be one whole line', () => {
		const text = `Text.\n\n${LINE}\n`
		expect(parseBlocks(text, 'p.md').map((b) => b.kind)).toEqual(['nav'])
		expect(stripComments(text)).toBe('Text.\n')
		expect(validateUnit({ name: 'u', pages: [{ name: 'pageIndex-000.md', text }] })).toEqual([])
		const bad = validateUnit({ name: 'u', pages: [{ name: 'pageIndex-000.md', text: 'Text <!-- nav: generated -->\n' }] })
		expect(bad.map((p) => p.message)).toEqual(['nav: must end a line of navigation links (see `npm run nav`)'])
	})
	it('builds the table of contents from the part blocks and replaces it in place', () => {
		const pub = '---\nformat: publication-md/0.1\nid: x\ntype: book\npageSequence: "1,2|3,4"\n---\n\nMigrated.\n'
		const pages = [{ name: 'pageIndex-000.md' }, { name: 'pageIndex-001.md' }, { name: 'pageIndex-002.md' }]
		const parts = [
			{ file: 'pageIndex-000.md', value: 'none' },
			{ file: 'pageIndex-001.md', value: { key: 'x|2-4|1', title: 'A | B', pages: '2-4', authors: ['Ann Ek', { name: 'Bo Ek', role: 'photographer' }] } },
			{ file: 'pageIndex-002.md', value: { key: 'x|2-4|1', continued: true } },
		]
		const block = tocBlock({ publication: pub, pages }, parts, NAV_LABELS.sv)
		expect(block).toBe(
			[
				'<!-- toc: start -->',
				'## Innehåll',
				'',
				'| Sid | Artikel | Författare |',
				'|---|---|---|',
				'| [2–4](pageIndex-001.md) | [A \\| B](pageIndex-001.md) | Ann Ek, *foto:* Bo Ek |',
				'',
				'**Sidor:** [1](pageIndex-000.md) · [2–3](pageIndex-001.md) · [4](pageIndex-002.md)',
				'<!-- toc: end -->',
			].join('\n'),
		)
		const withToc = applyToc(pub, block)
		expect(withToc).toBe(`${pub}\n${block}\n`)
		expect(applyToc(withToc, block)).toBe(withToc)
		expect(stripToc(withToc)).toBe(pub)
		const fm = '---\nformat: publication-md/0.1\nid: x\ntype: book\npageSequence: "1,2|3,4"\n---\n'
		const top = applyToc(pub, block, 'top')
		expect(top).toBe(`${fm}\n${block}\n\nMigrated.\n`)
		expect(stripToc(top)).toBe(pub)
		expect(applyToc(withToc, block, 'top')).toBe(top)
		expect(applyToc(top, block, 'bottom')).toBe(withToc)
		expect(applyToc(top, block, 'none')).toBe(pub)
		expect(tocBlock({ publication: pub, pages }, [], NAV_LABELS.sv)).toBeNull()
	})
	it('generates corrections for printed TOC rows whose first page differs, and strips them back', () => {
		const starts = new Map([['4-7~1', '4'], ['8-12~1', '8']])
		const page = [
			'## Innehåll',
			'',
			'|  |  |',
			'|---|---|',
			'| [Flanderstöten](../ref/g/2025-1/part/4-7~1.md) | 5 |',
			'| [Gruvan](../ref/g/2025-1/part/8-12~1.md) | 8-12 |',
			'| Utan länk | 9 |',
			'',
		].join('\n')
		const r = applyCorrections(page, 'g', '2025-1', starts, 'Rättad', 'pageIndex-001.md')
		expect(r.text.split('\n')[4]).toBe('| [Flanderstöten](../ref/g/2025-1/part/4-7~1.md) | 5 (Rättad: 4)<!-- toc: correction --> |')
		expect(r.text.split('\n').slice(5)).toEqual(page.split('\n').slice(5))
		expect(r.corrections).toEqual([{ file: 'pageIndex-001.md', title: 'Flanderstöten', printed: '5', correct: '4' }])
		expect(stripCorrections(r.text)).toBe(page.replace('| 5 |', '| 5 |'))
		expect(applyCorrections(r.text, 'g', '2025-1', starts, 'Rättad').text).toBe(r.text)
		expect(validateUnit({ name: 'u', pages: [{ name: 'pageIndex-001.md', text: r.text }] })).toEqual([])
	})
})
