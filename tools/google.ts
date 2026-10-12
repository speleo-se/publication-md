/**
 * Google login + Drive download for `npm run fetch`, without the gdrive CLI.
 *
 * A content repo names a Google OAuth client of type "Desktop app" in its publication-md.yaml:
 *
 *   google: {clientId: "….apps.googleusercontent.com", clientSecret: "GOCSPX-…"}
 *
 * For a desktop ("installed") app Google does not treat the client secret as confidential —
 * it ships inside every copy of the program — so it may be committed. Each user logs in with
 * their own Google account (`npm run fetch -- login`) and sees exactly the Drive files shared
 * with that account. Tokens are stored per user outside the repo, in
 * ~/.config/publication-md/google-<client>.json (a devcontainer volume keeps it across rebuilds).
 *
 * Login is OAuth 2.0 with PKCE and a loopback redirect. In a container the browser runs on the
 * host: VS Code forwards the port automatically; if it does not, paste the address the browser
 * ends up on (it contains `code=`) into the terminal instead.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export interface GoogleClient {
	clientId: string
	clientSecret?: string
}
interface Token {
	access_token: string
	refresh_token?: string
	expires_at: number
}

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const DRIVE = 'https://www.googleapis.com/drive/v3'

const tokenFile = (c: GoogleClient) =>
	join(process.env['PMD_CONFIG_DIR'] ?? join(homedir(), '.config', 'publication-md'), `google-${c.clientId.split('.')[0]}.json`)

const b64url = (b: Buffer) => b.toString('base64url')

async function tokenRequest(c: GoogleClient, params: Record<string, string>): Promise<Token> {
	const body = new URLSearchParams({ client_id: c.clientId, ...(c.clientSecret ? { client_secret: c.clientSecret } : {}), ...params })
	const res = await fetch(TOKEN, { method: 'POST', body })
	const j = (await res.json()) as Record<string, unknown>
	if (!res.ok) throw new Error(`Google token request failed: ${j['error_description'] ?? j['error'] ?? res.status}`)
	return {
		access_token: String(j['access_token']),
		...(j['refresh_token'] ? { refresh_token: String(j['refresh_token']) } : {}),
		expires_at: Date.now() + (Number(j['expires_in'] ?? 3600) - 60) * 1000,
	}
}

/** Interactive login; stores the token. */
export async function login(c: GoogleClient): Promise<void> {
	const verifier = b64url(randomBytes(32))
	const challenge = b64url(createHash('sha256').update(verifier).digest())
	const state = b64url(randomBytes(16))
	type Got = { code: string; redirect: string; reply?: (msg: string) => void }
	let resolveCode: (v: Got) => void = () => {}
	const got = new Promise<Got>((r) => {
		resolveCode = r
	})
	const server = createServer((req, res) => {
		const u = new URL(req.url ?? '/', 'http://127.0.0.1')
		const code = u.searchParams.get('code')
		const denied = u.searchParams.get('error')
		res.setHeader('content-type', 'text/plain; charset=utf-8')
		if (denied) res.end(`Google login failed: ${denied}. Return to the terminal.`)
		else if (code && u.searchParams.get('state') === state) {
			// Answer the browser only once the code has been exchanged, so it shows the real outcome.
			resolveCode({ code, redirect: redirectUri, reply: (msg) => res.end(msg) })
		} else res.end('Waiting for Google login …')
	})
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
	const port = (server.address() as { port: number }).port
	const redirectUri = `http://127.0.0.1:${port}`
	const url = `${AUTH}?${new URLSearchParams({
		client_id: c.clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: SCOPE,
		access_type: 'offline',
		prompt: 'consent',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state,
	})}`
	console.log('Open this address in your browser and log in with the Google account that has access to the PDFs:\n')
	console.log(`  ${url}\n`)
	console.log(`(Listening on port ${port}. If the browser ends on a page that does not load, copy that`)
	console.log(' whole address from the address bar and paste it here, then press Enter.)\n')
	const rl = createInterface({ input: process.stdin, output: process.stdout })
	rl.on('line', (line) => {
		try {
			const u = new URL(line.trim())
			const code = u.searchParams.get('code')
			if (code && u.searchParams.get('state') === state) resolveCode({ code, redirect: `${u.protocol}//${u.host}` })
			else console.log('That address has no matching code= — paste the full address after logging in.')
		} catch {
			console.log('Paste the full address (starting with http://127.0.0.1…).')
		}
	})
	const { code, redirect, reply } = await got
	rl.close()
	try {
		const t = await tokenRequest(c, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect })
		const f = tokenFile(c)
		mkdirSync(join(f, '..'), { recursive: true })
		writeFileSync(f, JSON.stringify(t), { mode: 0o600 })
		reply?.('Logged in — you can close this tab and return to the terminal.')
		console.log(`Logged in. Token saved to ${f}`)
	} catch (e) {
		reply?.(`Login failed: ${String(e instanceof Error ? e.message : e).replace(/\.$/, '')}. Return to the terminal.`)
		throw e
	} finally {
		server.close()
	}
}

/** A valid access token (refreshed when needed), or an error telling the user to log in. */
export async function accessToken(c: GoogleClient): Promise<string> {
	const f = tokenFile(c)
	if (!existsSync(f)) throw new Error('not logged in to Google — run: npm run fetch -- login')
	const t = JSON.parse(readFileSync(f, 'utf8')) as Token
	if (t.expires_at > Date.now()) return t.access_token
	if (!t.refresh_token) throw new Error('Google login expired — run: npm run fetch -- login')
	const fresh = await tokenRequest(c, { grant_type: 'refresh_token', refresh_token: t.refresh_token })
	writeFileSync(f, JSON.stringify({ ...t, ...fresh, refresh_token: t.refresh_token }), { mode: 0o600 })
	return fresh.access_token
}

/** File id of `name` in a Drive folder (shared drives included), or null. */
export async function findInFolder(c: GoogleClient, folder: string, name: string): Promise<string | null> {
	const q = `'${folder}' in parents and name = '${name.replaceAll("'", "\\'")}' and trashed = false`
	const url = `${DRIVE}/files?${new URLSearchParams({ q, fields: 'files(id,name)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`
	const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(c)}` } })
	if (res.status === 404) throw new Error(`Drive folder ${folder} not found — has it been shared with your Google account?`)
	if (!res.ok) throw new Error(`Drive list failed (${res.status}): ${await res.text()}`)
	const j = (await res.json()) as { files?: { id: string }[] }
	return j.files?.[0]?.id ?? null
}

export async function download(c: GoogleClient, id: string): Promise<Uint8Array> {
	const res = await fetch(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, {
		headers: { authorization: `Bearer ${await accessToken(c)}` },
	})
	if (!res.ok) throw new Error(`Drive download failed (${res.status})`)
	return new Uint8Array(await res.arrayBuffer())
}
