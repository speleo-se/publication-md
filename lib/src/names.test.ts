import { describe, expect, it } from 'vitest'
import { applyNames, checkNames, nameKey, parseNames } from './names.ts'

const NS = { units: new Set(['grottan']), entities: new Set(['ssf']) }
const NAMES = `
- printed: [Sotbäcksgrottan, Sotsbäcksgrottans]
  id: 1751
- printed: [Labyrintgrottan]
  candidates: [1752, 4095]
  hint: Kebnekaise → 1752
- printed: [Lulletjårrogrottan]
  id: unknown
`

describe('names files', () => {
	const { index, problems } = parseNames(NAMES)
	it('parses and normalises', () => {
		expect(problems).toEqual([])
		expect(index.get(nameKey('SOTSBÄCKSGROTTANS'))?.id).toBe('1751')
		expect(index.get(nameKey('sotbäcksgrottan'))?.id).toBe('1751') // NFD input
	})
	it('rejects bad entries', () => {
		const p = parseNames('- printed: [A]\n- printed: [B]\n  id: 1\n  candidates: [2]\n- printed: [a]\n  id: 3\n').problems.map((x) => x.message)
		expect(p).toEqual(['entry 0 (A): give exactly one of id or candidates', 'entry 1 (B): give exactly one of id or candidates'])
	})
	it('finds mismatches and unlisted names, and fixes fixed ids only', () => {
		const page = [
			'[Sotbäcksgrottan](../ref/ssf/unknown.md) och [Sotsbäcksgrottans](../ref/ssf/1751.md)',
			'[Labyrintgrottan](../ref/ssf/9999.md) [Labyrintgrottan](../ref/ssf/unknown.md) [Labyrintgrottan](../ref/ssf/4095.md)',
			'[Lulletjårrogrottan](../ref/ssf/658.md) [Ny grotta](../ref/ssf/12.md) [Grottan 4/86](../ref/grottan/1986-4.md)',
		].join('\n')
		const { mismatches, unlisted } = checkNames(page, 'p.md', 'ssf', index, NS)
		expect(mismatches.map((m) => `${m.line}:${m.text}:${m.current}->${m.expected ?? m.candidates?.join('/')}`)).toEqual([
			'1:Sotbäcksgrottan:unknown->1751',
			'2:Labyrintgrottan:9999->1752/4095',
			'3:Lulletjårrogrottan:658->unknown',
		])
		expect(unlisted).toEqual(['Ny grotta'])
		const fixed = applyNames(page, mismatches)
		expect(fixed).toContain('[Sotbäcksgrottan](../ref/ssf/1751.md)')
		expect(fixed).toContain('[Lulletjårrogrottan](../ref/ssf/unknown.md)')
		expect(fixed).toContain('[Labyrintgrottan](../ref/ssf/9999.md)') // candidate mismatch: reported, not auto-fixed
	})
})
