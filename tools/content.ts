#!/usr/bin/env node
/**
 * Manage the content repos of this workspace (see README "Workspace").
 *
 *   node tools/content.ts add <git-url|local-path> [--name <name>]   clone (url) or symlink (path)
 *   node tools/content.ts list
 *   node tools/content.ts use <name>
 *   node tools/content.ts remove <name>      unlinks a symlink; a clone is left for you to delete
 *
 * `add` checks the repo's publication-md.yaml, makes it the active repo, and reports anything
 * the environment needs for it (firewall domains for the devcontainer).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseContentConfig } from '../lib/src/index.ts'
import { activeName, CONTENT_DIR, listContent, WORK_DIR } from './workspace.ts'

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
	default:
		die('usage: content add|list|use|remove …  (see tools/content.ts)')
}
