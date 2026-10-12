import { describe, expect, it } from 'vitest'
import { compareUnits, parseContentConfig, sourceCovers, unitId, unitInfo } from './contentConfig.ts'

const YAML = `config: publication-md-content/0.1
name: grottan
units:
  glob: "SSF_Grottan_*_webb"
  patterns:
    - '^SSF_Grottan_(?<volume>\\d{4})_(?<issue>[\\d-]+)_(?<year>\\d{4})_webb$'
    - '^SSF_Grottan_(?<year>\\d{4})[_-](?<issue>[\\d-]+)_webb$'
sources:
  - {type: gdrive, folder: A, years: 1966-2006}
  - {type: gdrive, folder: B, years: 2007-}
`

describe('content config', () => {
	const { config, problems } = parseContentConfig(YAML)
	it('parses', () => {
		expect(problems).toEqual([])
		expect(config?.name).toBe('grottan')
	})
	it('reports problems', () => {
		const p = parseContentConfig('config: x\nname: Bad Name\nsources: [{type: ftp}]\n').problems.map((x) => x.message)
		expect(p).toEqual([
			'config must be "publication-md-content/0.1"',
			'name: required, [a-z0-9._-]',
			'units.glob: required',
			'sources[0].type: gdrive or http',
		])
	})
	it('parses unit names in all naming schemes and sorts like status.py', () => {
		if (!config) throw new Error('no config')
		const names = ['SSF_Grottan_2018-1-2_webb', 'SSF_Grottan_0001_2_1967_webb', 'SSF_Grottan_1987_2_webb', 'SSF_Grottan_0002_1_1967_webb', 'SSF_Grottan_2007-1_webb']
		const infos = names.map((n) => unitInfo(config, n)).filter((x) => x !== null)
		expect(infos.sort(compareUnits).map((i) => i.name)).toEqual([
			'SSF_Grottan_0002_1_1967_webb',
			'SSF_Grottan_0001_2_1967_webb',
			'SSF_Grottan_1987_2_webb',
			'SSF_Grottan_2007-1_webb',
			'SSF_Grottan_2018-1-2_webb',
		])
		expect(unitInfo(config, 'SSF_Grottan_0002_3-4_1968_webb')).toMatchObject({ year: 1968, issue: '3-4', volume: '0002' })
		expect(unitInfo(config, 'Other_2007')).toBeNull()
	})
	it('uses a per-pattern id template', () => {
		const c = parseContentConfig(`config: publication-md-content/0.1
name: g
units:
  glob: "SSF_Grottan_*_webb"
  id: "grottan-{year}-{issue}"
  patterns:
    - {pattern: '^SSF_Grottan_(?<volume>\\d{4})_(?<issue>[\\d-]+)_(?<year>\\d{4})_webb$', id: "grottan-{volume}-{issue}"}
    - '^SSF_Grottan_(?<year>\\d{4})[_-](?<issue>[\\d-]+)_webb$'
`).config
		if (!c) throw new Error('config')
		expect(unitId(c, 'SSF_Grottan_0001_2_1967_webb')).toBe('grottan-0001-2')
		expect(unitId(c, 'SSF_Grottan_0002_2_1967_webb')).toBe('grottan-0002-2')
		expect(unitId(c, 'SSF_Grottan_1987_2_webb')).toBe('grottan-1987-2')
		expect(unitInfo(c, 'SSF_Grottan_0001_2_1967_webb')?.year).toBe(1967)
	})
	it('selects the source by year', () => {
		const [a, b] = config?.sources ?? []
		if (!a || !b) throw new Error('no sources')
		expect([sourceCovers(a, 1987), sourceCovers(b, 1987), sourceCovers(b, 2026), sourceCovers(a, 2007)]).toEqual([true, false, true, false])
	})
})
