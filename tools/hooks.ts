#!/usr/bin/env node
/**
 * Git hook logic for content repos (installed by `npm run content -- hooks install`).
 * Doing the generation locally means the GitHub Action rarely has to commit back, so the
 * user does not have to pull after every push.
 *
 *   node tools/hooks.ts pre-commit --content-root <dir>
 *       regenerate ref/ and STATS.md and add them to the commit being made
 *   node tools/hooks.ts pre-push --content-root <dir>
 *       validate and check that ref/ is current; a failure blocks the push
 *
 * Bypass either with `git commit/push --no-verify`. The generators read the working tree, so
 * stage everything you mean to commit (unstaged edits to pages also feed into ref/).
 */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { ROOT } from './workspace.ts'

const [hook, ...argv] = process.argv.slice(2)
const i = argv.indexOf('--content-root')
const rootArg = i >= 0 ? argv[i + 1] : undefined
const contentRoot = resolve(rootArg ?? process.cwd())
const env = { ...process.env, PMD_CONTENT_ROOT: contentRoot }

const git = (...args: string[]) => spawnSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' })
const tool = (name: string, ...args: string[]) =>
	spawnSync(process.execPath, [join(ROOT, 'tools', name), ...args], { cwd: ROOT, env, encoding: 'utf8' })
const fail = (msg: string): never => {
	console.error(`publication-md ${hook}: ${msg}`)
	process.exit(1)
}

/** Paths whose change can change ref/ or STATS.md. */
const RELEVANT = /(^|\/)[^/]+-content\/|^publication-md\.yaml$|^people\.yaml$|^collections\//

switch (hook) {
	case 'pre-commit': {
		const staged = git('diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean)
		if (!staged.some((p) => RELEVANT.test(p))) process.exit(0) // README-only etc.: nothing to regenerate
		const refs = tool('refs.ts')
		if (refs.status !== 0) {
			process.stderr.write(refs.stderr)
			fail('reference errors (above) — fix the links, or commit with --no-verify')
		}
		const stats = tool('stats.ts')
		if (stats.status !== 0) fail(`stats failed:\n${stats.stderr}`)
		// A STATS.md whose only change is its "Generated <date>" line is not worth committing.
		if (git('diff', '--quiet', '-I', '^(Genererad|Generated) ', '--', 'STATS.md').status === 0) {
			git('checkout', '--', 'STATS.md')
		}
		const add = git('add', '-A', '--', 'ref', 'STATS.md')
		if (add.status !== 0) fail(add.stderr)
		const changed = git('diff', '--cached', '--name-only', '--', 'ref', 'STATS.md').stdout.trim()
		if (changed) console.log(`publication-md: regenerated and staged ${changed.split('\n').length} generated file(s)`)
		break
	}
	case 'pre-push': {
		const v = tool('validate.ts', '--errors-only')
		if (v.status !== 0) {
			process.stderr.write(v.stdout)
			fail('validation errors (above) — fix them, or push with --no-verify')
		}
		const r = tool('refs.ts', '--check')
		if (r.status !== 0) {
			process.stderr.write(r.stdout)
			fail('ref/ is out of date — run `npm run refs` in publication-md and commit the result')
		}
		break
	}
	default:
		fail('usage: hooks.ts pre-commit|pre-push --content-root <dir>')
}
