import { parse as parseYaml } from 'yaml'
import { parseImagePath } from './imagePath.ts'
import { stripGenerated } from './nav.ts'
import type { Block } from './types.ts'

const RE_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const RE_COMMENT = /<!--([\s\S]*?)-->/g
const RE_LEGACY_PAGE = /^\s*page\s+(\d+)\s*$/
const RE_STRUCTURED = /^\s*(page|part|figure|note):\s*([\s\S]*?)\s*$/
const RE_NAV = /^\s*nav:\s*generated\s*$/
const RE_CORRECTION = /^\s*toc:\s*correction\s*$/
const RE_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

/** Split a file into its YAML frontmatter (parsed) and body. Throws on invalid YAML. */
export function parseFrontmatter(text: string): { data: unknown; body: string } | null {
	const m = RE_FRONTMATTER.exec(text)
	if (!m) return null
	return { data: parseYaml(m[1] ?? ''), body: text.slice(m[0].length) }
}

const lineAt = (text: string, offset: number): number => {
	let n = 1
	for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++
	return n
}

/**
 * Extract the machine-readable blocks of one page file, in document order:
 * `<!-- page|part|figure|note: <yaml> -->` and markdown images.
 * Any other comment is returned as `unknown-comment` so callers can flag it.
 */
export function parseBlocks(text: string, file: string): Block[] {
	const found: { offset: number; block: Block }[] = []

	for (const m of text.matchAll(RE_COMMENT)) {
		const inner = m[1] ?? ''
		const loc = { file, line: lineAt(text, m.index) }
		if (RE_CORRECTION.test(inner)) {
			found.push({ offset: m.index, block: { kind: 'toc-correction', loc } })
			continue
		}
		const nav = RE_NAV.exec(inner)
		if (nav) {
			found.push({ offset: m.index, block: { kind: 'nav', loc } })
			continue
		}
		const legacy = RE_LEGACY_PAGE.exec(inner)
		if (legacy) {
			found.push({ offset: m.index, block: { kind: 'legacy-page', label: legacy[1] ?? '', loc } })
			continue
		}
		const s = RE_STRUCTURED.exec(inner)
		if (s) {
			const kind = s[1] as 'page' | 'part' | 'figure' | 'note'
			try {
				const value: unknown = parseYaml(s[2] ?? '')
				if (kind === 'page') {
					const ok = (typeof value === 'string' && value.trim()) || typeof value === 'number'
					found.push({
						offset: m.index,
						block: ok
							? { kind: 'page', label: String(value).trim(), loc }
							: { kind: 'yaml-error', block: 'page', message: 'label must be a string or number', loc },
					})
				} else {
					found.push({ offset: m.index, block: { kind, value, loc } })
				}
			} catch (e) {
				const message = e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)
				found.push({ offset: m.index, block: { kind: 'yaml-error', block: kind, message, loc } })
			}
			continue
		}
		found.push({ offset: m.index, block: { kind: 'unknown-comment', raw: m[0], loc } })
	}

	for (const m of text.matchAll(RE_IMAGE)) {
		const src = m[2] ?? ''
		found.push({
			offset: m.index,
			block: {
				kind: 'image',
				alt: m[1] ?? '',
				src,
				ref: parseImagePath(src),
				loc: { file, line: lineAt(text, m.index) },
			},
		})
	}

	return found.sort((a, b) => a.offset - b.offset).map((f) => f.block)
}

/** Remove navigation lines and every comment block, leaving the reading text (markdown) of a page. */
export function stripComments(text: string): string {
	return stripGenerated(text).replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n?/g, '')
}
