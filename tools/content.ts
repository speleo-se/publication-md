#!/usr/bin/env node
/**
 * Manage the content repos of this workspace (see README "Workspace").
 *
 *   node tools/content.ts add <git-url|local-path> [--name <name>]   clone (url) or symlink (path)
 *   node tools/content.ts list
 *   node tools/content.ts use <name>
 *   node tools/content.ts remove <name>      unlinks a symlink; a clone is left for you to delete
 *   node tools/content.ts init <dir> --name <name> [--title …] [--owner …] [--language sv]
 *                                            [--license …] [--note-label …]
 *                                            create a new, fully set-up content repo and add it
 *
 * `add` checks the repo's publication-md.yaml, makes it the active repo, and reports anything
 * the environment needs for it (firewall domains for the devcontainer).
 */
import { spawnSync } from 'node:child_process'
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseContentConfig } from '../lib/src/index.ts'
import { activeName, CONTENT_DIR, listContent, ROOT, WORK_DIR } from './workspace.ts'

const ACTIVE = join(CONTENT_DIR, '.active')
const [cmd, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
	const i = rest.indexOf(name)
	if (i < 0) return undefined
	const v = rest[i + 1]
	rest.splice(i, 2)
	return v
}
const die = (msg: string): never => {
	console.error(msg)
	process.exit(1)
}
const readConfig = (dir: string) => {
	const f = join(dir, 'publication-md.yaml')
	if (!existsSync(f)) return die(`${dir} has no publication-md.yaml — not a publication-md content repo (see spec/content-repo.md)`)
	const { config, problems } = parseContentConfig(readFileSync(f, 'utf8'))
	return config ?? die(`invalid ${f}:\n${problems.map((p) => `  ${p.message}`).join('\n')}`)
}

mkdirSync(CONTENT_DIR, { recursive: true })

switch (cmd) {
	case 'add': {
		const nameArg = flag('--name')
		const src = rest[0] ?? die('usage: content add <git-url|local-path> [--name <name>]')
		const isPath = existsSync(src)
		let dir: string
		if (isPath) {
			const target = resolve(src)
			const cfg = readConfig(target)
			dir = join(CONTENT_DIR, nameArg ?? cfg.name)
			if (existsSync(dir)) die(`content/${basename(dir)} already exists`)
			symlinkSync(target, dir)
			console.log(`linked content/${basename(dir)} -> ${target}`)
		} else {
			const guess = nameArg ?? basename(src).replace(/\.git$/, '')
			dir = join(CONTENT_DIR, guess)
			if (existsSync(dir)) die(`content/${guess} already exists`)
			console.log(`$ git clone ${src} content/${guess}`)
			const r = spawnSync('git', ['clone', src, dir], { stdio: 'inherit' })
			if (r.status !== 0) die('git clone failed')
		}
		const cfg = readConfig(dir)
		writeFileSync(ACTIVE, `${basename(dir)}\n`)
		mkdirSync(join(WORK_DIR, basename(dir)), { recursive: true })
		console.log(`active: ${basename(dir)} — ${cfg.title ?? cfg.name}${cfg.owner ? ` (${cfg.owner})` : ''}`)
		if (cfg.copyright) console.log(`copyright: ${cfg.copyright}`)
		if (cfg.license) console.log(`license: ${cfg.license}`)
		if (cfg.firewall?.length) {
			console.log(`\nThis content needs network access to: ${cfg.firewall.join(', ')}`)
			console.log('In the devcontainer, add them to .devcontainer/init-firewall.sh (domains=…) and rebuild.')
		}
		console.log('\nNext: npm run validate   ·   npm run fetch -- <unit>   ·   ask Claude to transcribe the next unit')
		break
	}
	case 'list': {
		let active: string | undefined
		try {
			active = activeName()
		} catch {}
		const names = listContent()
		if (!names.length) console.log('no content repos — npm run content add <git-url|path>')
		for (const n of names) {
			const dir = join(CONTENT_DIR, n)
			const link = lstatSync(dir).isSymbolicLink() ? ` -> ${readlinkSync(dir)}` : ''
			let title = ''
			try {
				const { config } = parseContentConfig(readFileSync(join(dir, 'publication-md.yaml'), 'utf8'))
				title = config?.title ?? ''
			} catch {
				title = '(no publication-md.yaml)'
			}
			console.log(`${n === active ? '*' : ' '} ${n}  ${title}${link}`)
		}
		break
	}
	case 'use': {
		const n = rest[0] ?? die('usage: content use <name>')
		if (!listContent().includes(n)) die(`no content/${n} (have: ${listContent().join(', ') || 'none'})`)
		readConfig(join(CONTENT_DIR, n))
		writeFileSync(ACTIVE, `${n}\n`)
		console.log(`active: ${n}`)
		break
	}
	case 'remove': {
		const n = rest[0] ?? die('usage: content remove <name>')
		const dir = join(CONTENT_DIR, n)
		if (!existsSync(dir) && !lstatSync(dir, { throwIfNoEntry: false })) die(`no content/${n}`)
		if (!lstatSync(dir).isSymbolicLink()) {
			die(`content/${n} is a clone; delete it yourself after checking for unpushed work (git -C content/${n} status)`)
		}
		unlinkSync(dir)
		if (existsSync(ACTIVE) && readFileSync(ACTIVE, 'utf8').trim() === n) unlinkSync(ACTIVE)
		console.log(`unlinked content/${n} (the repo itself is untouched)`)
		break
	}
	case 'init': {
		const name = flag('--name') ?? die('usage: content init <dir> --name <name> [--title …] [--owner …] [--language sv]')
		if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) die('--name must be [a-z0-9._-] (lower case)')
		const title = flag('--title') ?? name
		const owner = flag('--owner') ?? 'TODO: owner'
		const language = flag('--language') ?? 'en'
		const license = flag('--license') ?? 'TODO: licence or terms of use of the content.'
		const noteLabel = flag('--note-label') ?? (language === 'sv' ? 'Transkriberingsnot' : 'Transcription note')
		const dir = resolve(rest[0] ?? die('usage: content init <dir> --name <name> …'))
		if (existsSync(dir) && readdirSync(dir).length) die(`${dir} exists and is not empty`)
		const values: Record<string, string> = { name, title, owner, language, license, noteLabel, copyright: `© ${owner}` }
		const fill = (text: string, yaml: boolean) =>
			text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
				const v = values[k]
				if (v === undefined) return m
				// In YAML, free-text values are quoted; name/language are path-safe tokens.
				return yaml && !['name', 'language'].includes(k) ? JSON.stringify(v) : v
			})
		const tpl = join(ROOT, 'templates', 'content-repo')
		const walk = (d: string): string[] =>
			readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]))
		for (const src of walk(tpl)) {
			const rel = relative(tpl, src).replaceAll('{{name}}', name)
			const dest = join(dir, rel)
			mkdirSync(dirname(dest), { recursive: true })
			writeFileSync(dest, fill(readFileSync(src, 'utf8'), /\.ya?ml$/.test(src) && !rel.startsWith('.github')))
			console.log(`  + ${rel}`)
		}
		const { problems } = parseContentConfig(readFileSync(join(dir, 'publication-md.yaml'), 'utf8'))
		if (problems.length) die(`template produced an invalid publication-md.yaml:\n${problems.map((p) => `  ${p.message}`).join('\n')}`)
		console.log(`$ git init -b main ${dir}`)
		spawnSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'inherit' })
		const link = join(CONTENT_DIR, name)
		if (existsSync(link)) die(`content/${name} already exists — created ${dir} but did not link it`)
		symlinkSync(dir, link)
		writeFileSync(ACTIVE, `${name}\n`)
		mkdirSync(join(WORK_DIR, name), { recursive: true })
		console.log(`\ncreated ${dir} and linked content/${name} (active)`)
		console.log(`Next:
  1. Edit ${join(dir, 'publication-md.yaml')}: units.glob/patterns, sources, owner/licence.
  2. Fill in ${join(dir, 'rules/transcribe.md')}.
  3. Create the GitHub repo, then: git -C ${dir} add -A && git -C ${dir} commit -m "Initial content repo" && git -C ${dir} push
  4. Optional: add it to registry.yaml in publication-md (pull request).`)
		break
	}
	default:
		die('usage: content add|list|use|remove|init …  (see tools/content.ts)')
}
