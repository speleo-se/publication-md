import { describe, expect, it } from 'vitest'
import { parseContentConfig } from './contentConfig.ts'
import { bumpVersion, type Migration, planUpgrade, upgradeFiles, versionOf } from './migrations.ts'
import { CURRENT_VERSION } from './types.ts'
import { validateUnit } from './validate.ts'

const files = () =>
	new Map([
		['publication-md.yaml', 'config: publication-md-content/0.1\nname: t\nunits: {glob: "t_*"}\n'],
		['t_1-content/publication.md', '---\nformat: publication-md/0.1\nid: t-1\ntype: book\nfieldA: x\n---\n'],
		['t_1-content/pageIndex-000.md', '<!-- part: {key: k, type: chapter, oldName: Kapitel} -->\nText.\n'],
		['.github/workflows/publication-md.yml', 'uses: speleo-se/publication-md/.github/workflows/content.yml@v0.1\nwith: { publication-md-ref: v0.1 }\n'],
		['README.md', 'Unrelated v0.1 text.\n'],
	])

// A test-only migration: renames a part key, as a real 0.1 → 0.2 change might.
const FAKE: Migration[] = [
	{
		from: '0.1',
		to: '0.2',
		describe: 'part.oldName → part.title',
		migrate: (f) => new Map([...f].map(([p, t]) => [p, p.endsWith('.md') ? t.replace('oldName:', 'title:') : t])),
	},
]

describe('migrations', () => {
	it('has nothing to do at the current version', () => {
		expect(planUpgrade(CURRENT_VERSION)).toEqual([])
		expect(versionOf(files().get('publication-md.yaml') ?? '')).toBe('0.1')
	})
	it('runs a chain: content migrated, versions bumped, unrelated files untouched', () => {
		const { files: out, steps } = upgradeFiles(files(), '0.1', '0.2', FAKE)
		expect(steps).toEqual(['0.1 → 0.2: part.oldName → part.title'])
		expect(out.get('publication-md.yaml')).toContain('config: publication-md-content/0.2')
		expect(out.get('t_1-content/publication.md')).toContain('format: publication-md/0.2')
		expect(out.get('t_1-content/pageIndex-000.md')).toContain('title: Kapitel')
		expect(out.get('.github/workflows/publication-md.yml')).toBe(
			'uses: speleo-se/publication-md/.github/workflows/content.yml@v0.2\nwith: { publication-md-ref: v0.2 }\n',
		)
		expect(out.get('README.md')).toBe('Unrelated v0.1 text.\n')
	})
	it('leaves a branch-pinned workflow alone', () => {
		const f = new Map([['.github/workflows/publication-md.yml', 'uses: x/content.yml@main\nwith: { publication-md-ref: main }\n']])
		expect(bumpVersion(f, '0.2').get('.github/workflows/publication-md.yml')).toContain('@main')
	})
	it('reports unknown versions and missing paths', () => {
		expect(() => planUpgrade('9.9', '0.2', FAKE)).toThrow(/version 9\.9, newer than these tools/)
		expect(() => planUpgrade('0.0', CURRENT_VERSION, [])).toThrow(/no upgrade path from version 0\.0/)
	})
	it('points an outdated repo at the upgrade command', () => {
		const old = parseContentConfig('config: publication-md-content/0.0\nname: t\nunits: {glob: "t_*"}\n')
		expect(old.problems[0]?.message).toMatch(/content is publication-md-content 0\.0, these tools are 0\.1 — run: npm run content -- upgrade/)
		expect(parseContentConfig('config: publication-md-content/9.0\nname: t\nunits: {glob: "t_*"}\n').problems[0]?.message).toMatch(
			/newer than these tools \(0\.1\) — update publication-md/,
		)
		const unit = validateUnit({ name: 'u', publication: '---\nformat: publication-md/0.0\nid: a\ntype: book\n---\n', pages: [] })
		expect(unit[0]?.message).toMatch(/content is publication-md 0\.0.*upgrade/)
	})
})
