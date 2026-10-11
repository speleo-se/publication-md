#!/usr/bin/env node
/**
 * Corpus statistics for the active content repo -> <content>/STATS.md.
 *
 *   node tools/stats.ts [output.md] [--content <name>]
 *
 * Counts every *-content/pageIndex-*.md. Years come from the content config's unit patterns.
 * The report is Swedish when the content's `language` is `sv`, else English.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unitInfo } from '../lib/src/index.ts'
import { loadWorkspace, takeContentArg } from './workspace.ts'

const argv = process.argv.slice(2)
const ws = loadWorkspace(takeContentArg(argv))
const ROOT = ws.contentRoot
const OUT = argv[0] ? resolve(argv[0]) : join(ROOT, 'STATS.md')

const COLS = ['pages', 'words', 'chars', 'charsNoSpace', 'lines', 'textLines'] as const
type Col = (typeof COLS)[number]
type Stats = Record<Col, number>
const SV = ws.config.language === 'sv'
const T = SV
  ? { heads: ['Sidor', 'Ord', 'Tecken', 'Tecken (utan blanksteg)', 'Rader', 'Icke-tomma rader'], title: (t: string) => `Statistik över ${t}-transkriberingen`, generated: 'Genererad', by: 'av', summary: 'Sammanfattning', measure: 'Mått', total: 'Totalt', avg: 'Snitt / nummer', units: 'Nummer', years: 'Antal årgångar', wpp: 'Ord / sida', perYear: 'Per år', year: 'År', perUnit: 'Per nummer' }
  : { heads: ['Pages', 'Words', 'Characters', 'Characters (no spaces)', 'Lines', 'Non-empty lines'], title: (t: string) => `Statistics for the ${t} transcription`, generated: 'Generated', by: 'by', summary: 'Summary', measure: 'Measure', total: 'Total', avg: 'Average / unit', units: 'Units', years: 'Years', wpp: 'Words / page', perYear: 'Per year', year: 'Year', perUnit: 'Per unit' }
const HEADS = T.heads
const SHORT = String(ws.config['shortTitle'] ?? ws.config.title ?? ws.config.name)

const empty = (): Stats => ({ pages: 0, words: 0, chars: 0, charsNoSpace: 0, lines: 0, textLines: 0 })
const add = (a: Stats, b: Stats): void => {
  for (const c of COLS) a[c] += b[c]
}
const fmt = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const yearOf = (dir: string): string => {
  const year = unitInfo(ws.config, dir.replace(/-content$/, ''))?.year
  return year === undefined ? '?' : String(year)
}

function pageStats(text: string): Stats {
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop() // match splitlines(): trailing newline is not a line
  return {
    pages: 1,
    words: text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0,
    chars: [...text].length,
    charsNoSpace: [...text.replace(/\s/gu, '')].length,
    lines: lines.length,
    textLines: lines.filter((l) => l.trim()).length,
  }
}

const issues: { name: string; year: string; s: Stats }[] = []
for (const dir of readdirSync(ROOT).filter((d) => d.endsWith('-content')).sort()) {
  const pages = readdirSync(join(ROOT, dir)).filter((f) => /^pageIndex-.*\.md$/.test(f))
  if (!pages.length) continue
  const s = empty()
  for (const p of pages) add(s, pageStats(readFileSync(join(ROOT, dir, p), 'utf8')))
  issues.push({ name: dir.replace(/-content$/, ''), year: yearOf(dir), s })
}

const total = empty()
const byYear = new Map<string, { issues: number; s: Stats }>()
for (const { year, s } of issues) {
  add(total, s)
  const y = byYear.get(year) ?? { issues: 0, s: empty() }
  y.issues++
  add(y.s, s)
  byYear.set(year, y)
}
const years = [...byYear.keys()].sort()
const n = issues.length || 1
const row = (s: Stats) => COLS.map((c) => fmt(s[c])).join(' | ')

const out = [
  `# ${T.title(SHORT)}`,
  '',
  `${T.generated} ${new Date().toISOString().slice(0, 10)} ${T.by} \`publication-md/tools/stats.ts\`.`,
  '',
  `## ${T.summary}`,
  '',
  `| ${T.measure} | ${T.total} | ${T.avg} |`,
  '|---|--:|--:|',
  `| ${T.units} | ${fmt(issues.length)} | |`,
  `| ${T.years} | ${years.length} (${years[0] ?? '-'}–${years.at(-1) ?? '-'}) | |`,
  ...COLS.map((c, i) => `| ${HEADS[i]} | ${fmt(total[c])} | ${fmt(Math.round(total[c] / n))} |`),
  ...(total.pages ? [`| ${T.wpp} | ${fmt(Math.round(total.words / total.pages))} | |`] : []),
  '',
  `## ${T.perYear}`,
  '',
  `| ${T.year} | ${T.units} | ${HEADS.join(' | ')} |`,
  `|---${'|--:'.repeat(COLS.length + 1)}|`,
  ...years.map((y) => {
    const v = byYear.get(y)!
    return `| ${y} | ${v.issues} | ${row(v.s)} |`
  }),
  '',
  `## ${T.perUnit}`,
  '',
  `| ${T.units} | ${T.year} | ${HEADS.join(' | ')} |`,
  `|---|---${'|--:'.repeat(COLS.length)}|`,
  ...issues.map((i) => `| ${i.name} | ${i.year} | ${row(i.s)} |`),
]

writeFileSync(OUT, `${out.join('\n')}\n`, 'utf8')
console.log(`Wrote ${OUT} (${issues.length} issues, ${fmt(total.words)} words)`)
