#!/usr/bin/env node
/**
 * Corpus statistics for the active content repo -> <content>/STATS.md.
 *
 *   node tools/stats.ts [output.md] [--content <name>]
 *
 * Counts every *-content/pageIndex-*.md: text measures, plus publication-md metadata — figures,
 * reference links (and how many still point at …/unknown.md), subjects — and the size of the
 * extracted images. Years come from the content config's unit patterns. The report is Swedish
 * when the content's `language` is `sv`, else English.
 *
 * Image size is measured from <unit>-content/img/ (gitignored, made by extract-images). Where a
 * unit's images are not all present (CI, a fresh clone) its size is carried over from the existing
 * STATS.md, so every machine writes the same numbers and the hook and CI never fight.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findLinks, parseBlocks, parseRef, type RefNamespaces, unitInfo } from '../lib/src/index.ts'
import { loadWorkspace, takeContentArg } from './workspace.ts'

const argv = process.argv.slice(2)
const ws = loadWorkspace(takeContentArg(argv))
const ROOT = ws.contentRoot
const OUT = argv[0] ? resolve(argv[0]) : join(ROOT, 'STATS.md')

const COLS = ['pages', 'words', 'chars', 'charsNoSpace', 'lines', 'textLines', 'figures', 'refs', 'unresolved', 'subjects'] as const
type Col = (typeof COLS)[number]
type Stats = Record<Col, number>
const SV = ws.config.language === 'sv'
const T = SV
  ? { heads: ['Sidor', 'Ord', 'Tecken', 'Tecken (utan blanksteg)', 'Rader', 'Icke-tomma rader', 'Figurer', 'Referenser', 'varav olösta', 'Ämnen'], img: 'Bildstorlek (extraherade bilder)', imgNote: 'Bildstorlek = de extraherade bildfilerna (`img/`, skapas med extract-images). Där bilderna inte finns på maskinen behålls det senast kända värdet; – = okänt.', title: (t: string) => `Statistik över ${t}-transkriberingen`, generated: 'Genererad', by: 'av', summary: 'Sammanfattning', measure: 'Mått', total: 'Totalt', avg: 'Snitt / nummer', units: 'Nummer', years: 'Antal årgångar', wpp: 'Ord / sida', perYear: 'Per år', year: 'År', perUnit: 'Per nummer' }
  : { heads: ['Pages', 'Words', 'Characters', 'Characters (no spaces)', 'Lines', 'Non-empty lines', 'Figures', 'References', 'of which unresolved', 'Subjects'], img: 'Image size (extracted images)', imgNote: 'Image size = the extracted image files (`img/`, made by extract-images). Where the images are not present on the machine the last known value is kept; – = unknown.', title: (t: string) => `Statistics for the ${t} transcription`, generated: 'Generated', by: 'by', summary: 'Summary', measure: 'Measure', total: 'Total', avg: 'Average / unit', units: 'Units', years: 'Years', wpp: 'Words / page', perYear: 'Per year', year: 'Year', perUnit: 'Per unit' }
const HEADS = T.heads
const SHORT = String(ws.config['shortTitle'] ?? ws.config.title ?? ws.config.name)

const empty = (): Stats => ({ pages: 0, words: 0, chars: 0, charsNoSpace: 0, lines: 0, textLines: 0, figures: 0, refs: 0, unresolved: 0, subjects: 0 })
const add = (a: Stats, b: Stats): void => {
  for (const c of COLS) a[c] += b[c]
}
const fmt = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const yearOf = (dir: string): string => {
  const year = unitInfo(ws.config, dir.replace(/-content$/, ''))?.year
  return year === undefined ? '?' : String(year)
}

const refs = Object.entries(ws.config.refs ?? {})
const NS: RefNamespaces = {
  units: new Set(refs.filter(([, v]) => v?.units).map(([k]) => k)),
  entities: new Set(refs.filter(([, v]) => !v?.units).map(([k]) => k)),
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function pageStats(text: string, name: string, images: Set<string>): Stats {
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop() // match splitlines(): trailing newline is not a line
  const s: Stats = {
    pages: 1,
    words: text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0,
    chars: [...text].length,
    charsNoSpace: [...text.replace(/\s/gu, '')].length,
    lines: lines.length,
    textLines: lines.filter((l) => l.trim()).length,
    figures: 0,
    refs: 0,
    unresolved: 0,
    subjects: 0,
  }
  for (const l of findLinks(text)) {
    if (!/(^|\/)ref\//.test(l.href)) continue
    s.refs++
    if (parseRef(l.href, NS)?.kind === 'unresolved') s.unresolved++
  }
  for (const b of parseBlocks(text, name)) {
    if (b.kind === 'figure') s.figures++
    if (b.kind === 'image' && b.ref) images.add(b.src)
    if ((b.kind === 'figure' || b.kind === 'part') && isObj(b.value) && Array.isArray(b.value.subjects)) s.subjects += b.value.subjects.length
  }
  return s
}

// Image size per unit in whole kB; carried over from the previous STATS.md where not measurable.
const kB = (n: number) => `${fmt(n)} kB`
const previousKB = new Map<string, number>()
if (existsSync(OUT)) {
  let col = -1
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    if (cells.includes(T.img)) col = cells.indexOf(T.img)
    else if (col > 0 && cells[1] && /\d/.test(cells[col] ?? '')) {
      const v = Number((cells[col] ?? '').replace(/[^\d]/g, ''))
      if (!Number.isNaN(v)) previousKB.set(cells[1], v)
    }
    if (line.startsWith('## ') && !line.includes(T.perUnit)) col = -1
  }
}
function imageKB(name: string, dir: string, images: Set<string>): number | null {
  if (!images.size) return 0
  let bytes = 0
  for (const src of images) {
    const f = join(ROOT, dir, src)
    if (!existsSync(f)) return previousKB.get(name) ?? null
    bytes += statSync(f).size
  }
  return Math.round(bytes / 1024)
}

const issues: { name: string; year: string; s: Stats; kb: number | null }[] = []
for (const dir of readdirSync(ROOT).filter((d) => d.endsWith('-content')).sort()) {
  const pages = readdirSync(join(ROOT, dir)).filter((f) => /^pageIndex-.*\.md$/.test(f))
  if (!pages.length) continue
  const s = empty()
  const images = new Set<string>()
  for (const p of pages) add(s, pageStats(readFileSync(join(ROOT, dir, p), 'utf8'), p, images))
  const name = dir.replace(/-content$/, '')
  issues.push({ name, year: yearOf(dir), s, kb: imageKB(name, dir, images) })
}

const total = empty()
let totalKB = 0
let knownKB = false
const byYear = new Map<string, { issues: number; s: Stats; kb: number }>()
for (const { year, s, kb } of issues) {
  add(total, s)
  totalKB += kb ?? 0
  knownKB ||= (kb ?? 0) > 0
  const y = byYear.get(year) ?? { issues: 0, s: empty(), kb: 0 }
  y.issues++
  y.kb += kb ?? 0
  add(y.s, s)
  byYear.set(year, y)
}
const mb = (k: number) => `${(k / 1024).toFixed(1).replace('.', SV ? ',' : '.')} MB`
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
  ...(knownKB ? [`| ${T.img} | ${mb(totalKB)} | |`] : []),
  '',
  `## ${T.perYear}`,
  '',
  `| ${T.year} | ${T.units} | ${HEADS.join(' | ')} | ${T.img} |`,
  `|---${'|--:'.repeat(COLS.length + 2)}|`,
  ...years.map((y) => {
    const v = byYear.get(y)!
    return `| ${y} | ${v.issues} | ${row(v.s)} | ${v.kb ? kB(v.kb) : ''} |`
  }),
  '',
  `## ${T.perUnit}`,
  '',
  `| ${T.units} | ${T.year} | ${HEADS.join(' | ')} | ${T.img} |`,
  `|---|---${'|--:'.repeat(COLS.length + 1)}|`,
  ...issues.map((i) => `| ${i.name} | ${i.year} | ${row(i.s)} | ${i.kb === null ? '–' : i.kb ? kB(i.kb) : ''} |`),
  '',
  `<sub>${T.imgNote}</sub>`,
]

writeFileSync(OUT, `${out.join('\n')}\n`, 'utf8')
console.log(`Wrote ${OUT} (${issues.length} issues, ${fmt(total.words)} words)`)
