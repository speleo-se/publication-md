import { describe, expect, it } from 'vitest'
import { parseContentConfig, unitId } from './contentConfig.ts'
import { buildCorpus, collectRefs } from './corpus.ts'
import { findLinks, parseRef, parseSubject, refId, refPath } from './refs.ts'

const NS = { units: new Set(['grottan']), entities: new Set(['ssf']) }

describe('ref paths', () => {
	it('parses and round-trips every target kind', () => {
		const cases: [string, string][] = [
			['../ref/grottan/1982-4.md', 'grottan-1982-4'],
			['../ref/grottan/1986-4/p22.md', 'grottan-1986-4@22'],
			['../ref/grottan/1987-2/1987-2~4-9~1.md', 'grottan-1987-2#1987-2|4-9|1'],
			['../ref/ssf/933.md', 'ssf:933'],
			['../ref/ssf/unknown.md', 'ssf:?'],
		]
		for (const [href, id] of cases) {
			const t = parseRef(href, NS)
			expect(t && refId(t), href).toBe(id)
			expect(t && `../${refPath(t)}`).toBe(href)
		}
		expect(parseRef('https://example.org/x.md', NS)).toBeNull()
		expect(parseRef('../ref/other/1.md', NS)).toBeNull() // undeclared namespace
		expect(parseRef('../ref/ssf/933/x.md', NS)).toBeNull() // entities have no sub-targets
		expect(parseSubject('ssf/933', NS)).toEqual({ kind: 'entity', ns: 'ssf', id: '933' })
	})
	it('finds links but not images', () => {
		expect(findLinks('a [b](../ref/ssf/1.md) ![c](img/p000_pct-0,0,1,1.jpg)\n[d](x)').map((l) => [l.text, l.line])).toEqual([
			['b', 1],
			['d', 2],
		])
	})
})

describe('corpus refs', () => {
	const { config } = parseContentConfig(`config: publication-md-content/0.1
name: t
units:
  glob: "T_*"
  patterns: ['^T_(?<year>\\d{4})_(?<issue>\\d+)$']
  id: "t-{year}-{issue}"
refs:
  t: {units: true}
  ssf: {title: Riksnummer}
`)
	if (!config) throw new Error('config')
	it('derives unit ids from the template', () => {
		expect(unitId(config, 'T_1987_2')).toBe('t-1987-2')
	})
	const corpus = buildCorpus(
		[
			{
				folder: 'T_1987_1-content',
				publication: '---\nformat: publication-md/0.1\nid: t-1987-1\ntype: periodical\npageSequence: "1,2|3"\n---\n',
				pages: [
					{ name: 'pageIndex-000.md', text: '<!-- part: {key: "1987-1|1|1", type: chapter} -->\nEtt.' },
					{ name: 'pageIndex-001.md', text: '<!-- page: 2 -->\nTvå <!-- page: 3 --> tre [där](../ref/t/1987-2/p2.md).' },
				],
			},
			{
				folder: 'T_1987_2-content',
				pages: [
					{ name: 'pageIndex-000.md', text: 'Se [s. 3](../ref/t/1987-1/p3.md), [artikeln](../ref/t/1987-1/1987-1~1~1.md) och [Grottan](../ref/ssf/933.md).' },
					{ name: 'pageIndex-001.md', text: '![x](img/p001_pct-0,0,10,10.jpg)\n<!-- figure: {key: "1987-2|2|1", subjects: [ssf/933]} -->\n[fel](../ref/t/1999-9.md) [okänd](../ref/ssf/unknown.md) [sida](../ref/t/1987-1/p9.md) [ns](../ref/nope/1.md)' },
				],
			},
		],
		config,
	)
	const { refs, problems } = collectRefs(corpus)
	it('resolves targets, labels and mention locations', () => {
		const cave = refs.get('ssf:933')
		expect(cave?.mentions.map((m) => [m.kind, m.unit.id, m.label])).toEqual([
			['mention', 't-1987-2', '1'],
			['subject', 't-1987-2', '2'],
		])
		expect(refs.get('t-1987-1@3')?.mentions[0]?.unit.id).toBe('t-1987-2')
		expect(refs.get('t-1987-2@2')?.mentions[0]?.label).toBe('3') // after the inline marker
		expect(refs.has('t-1987-1#1987-1|1|1')).toBe(true)
		expect(refs.get('ssf:?')?.mentions).toHaveLength(1)
	})
	it('reports unknown units and labels', () => {
		expect(problems.map((p) => p.message)).toEqual([
			'../ref/t/1999-9.md: no unit "t-1999-9" in this repo',
			'../ref/t/1987-1/p9.md: unit t-1987-1 has no printed page "9"',
			'../ref/nope/1.md: namespace "nope" is not declared under refs: in publication-md.yaml',
		])
	})
})
