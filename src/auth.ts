import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { info, warn } from './util.ts'

const LOGIN_BASE = 'https://login.yotoplay.com'
const AUTHORIZE_URL = `${LOGIN_BASE}/authorize`
const TOKEN_URL = `${LOGIN_BASE}/oauth/token`
const AUDIENCE = 'https://api.yotoplay.com'

/**
 * user:content:manage creates and updates MYO playlists and must be ticked for
 * the app in dashboard.yoto.dev, or authorize comes back access_denied.
 * user:icons:manage is needed for custom chapter icons and user:content:view to
 * read a card back. The dashboard marks both "included automatically", but the
 * issued token only ever carries the scopes we actually ask for, so a missing
 * one shows up as a 403 at the point of use rather than at login.
 *
 * offline_access is deliberately absent: the dashboard does not offer it for
 * public apps, and requesting it fails the whole authorize call with
 * "scopes that have not been pre-approved". That means no refresh token, so
 * when the 24 hour access token expires we simply sign in again.
 */
const SCOPE = 'user:content:manage user:icons:manage user:content:view'

/** The dashboard requires this exact loopback URL, port included. */
const REDIRECT_PORT = 8787
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`

const STORE_DIR = path.join(homedir(), '.leia')
const TOKEN_FILE = path.join(STORE_DIR, 'token.json')
const CONFIG_FILE = path.join(STORE_DIR, 'config.json')

type StoredToken = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** Read the exp claim out of the access token rather than trusting expires_in. */
function jwtExpiry(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number }
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null
  } catch {
    return null
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeSecret(file: string, value: unknown): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true, mode: 0o700 })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export async function resolveClientId(): Promise<string> {
  const fromEnv = process.env.YOTO_CLIENT_ID?.trim()
  if (fromEnv) return fromEnv

  const config = await readJson<{ clientId?: string }>(CONFIG_FILE)
  const fromFile = config?.clientId?.trim()
  if (fromFile) return fromFile

  throw new Error(
    [
      'No Yoto client ID found.',
      '',
      'Create a Public app at https://dashboard.yoto.dev with:',
      `  redirect URL: ${REDIRECT_URI}`,
      `  scopes:       ${SCOPE}`,
      '',
      'Then either export YOTO_CLIENT_ID=... or write:',
      `  ${CONFIG_FILE}   {"clientId": "..."}`,
    ].join('\n'),
  )
}

function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Nothing to do; the URL is printed either way.
  }
}

async function exchange(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Token request failed (${response.status}): ${text.slice(0, 400)}`)
  }
  return JSON.parse(text) as TokenResponse
}

function persist(token: TokenResponse, previousRefresh?: string): Promise<void> {
  const expiresAt =
    jwtExpiry(token.access_token) ?? Date.now() + (token.expires_in ?? 3600) * 1000
  const stored: StoredToken = {
    accessToken: token.access_token,
    // Refresh tokens are single-use, so the new one always replaces the old.
    refreshToken: token.refresh_token ?? previousRefresh,
    expiresAt,
  }
  return writeSecret(TOKEN_FILE, stored)
}

/**
 * Authorization-code + PKCE, with the redirect caught on a local loopback server.
 *
 * forcePrompt sends prompt=login, which matters when switching accounts: the
 * Yoto SSO cookie would otherwise silently re-authorise whoever is already
 * signed in, with no visible login form and no hint that it picked for you.
 */
async function interactiveLogin(clientId: string, forcePrompt = false): Promise<StoredToken> {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  const authorizeUrl = new URL(AUTHORIZE_URL)
  authorizeUrl.search = new URLSearchParams({
    audience: AUDIENCE,
    scope: SCOPE,
    response_type: 'code',
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
    state,
    ...(forcePrompt ? { prompt: 'login' } : {}),
  }).toString()

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${REDIRECT_PORT}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }

      const respond = (message: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Leia</title>` +
            `<body style="font:16px/1.5 system-ui;padding:3rem;max-width:32rem">` +
            `<h1 style="font-size:1.25rem">Leia</h1><p>${message}</p></body>`,
        )
      }

      const returnedState = url.searchParams.get('state') ?? ''
      const expected = Buffer.from(state)
      const actual = Buffer.from(returnedState)
      const stateOk = actual.length === expected.length && timingSafeEqual(actual, expected)

      if (!stateOk) {
        respond('State mismatch. Close this tab and run the command again.')
        server.close()
        reject(new Error('OAuth state mismatch; login aborted'))
        return
      }

      const error = url.searchParams.get('error')
      if (error) {
        // error_description carries the actual reason, e.g. an unapproved scope.
        const description = url.searchParams.get('error_description')
        const detail = description ? `${error}: ${description}` : error
        respond(`Login failed: ${detail}. You can close this tab.`)
        server.close()
        reject(new Error(`Authorization denied. ${detail}`))
        return
      }

      const returnedCode = url.searchParams.get('code')
      if (!returnedCode) {
        respond('No authorization code returned. You can close this tab.')
        server.close()
        reject(new Error('No authorization code in callback'))
        return
      }

      respond('Signed in. You can close this tab and go back to the terminal.')
      server.close()
      resolve(returnedCode)
    })

    server.on('error', reject)

    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for the browser callback (5 minutes)'))
    }, 5 * 60_000)
    timer.unref()

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      info('Opening your browser to sign in to Yoto.')
      info(`If it does not open, visit:\n  ${authorizeUrl.toString()}`)
      openBrowser(authorizeUrl.toString())
    })
  })

  const token = await exchange({
    grant_type: 'authorization_code',
    client_id: clientId,
    code_verifier: verifier,
    code,
    redirect_uri: REDIRECT_URI,
  })

  await persist(token)
  info('Signed in to Yoto.')
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: jwtExpiry(token.access_token) ?? Date.now() + (token.expires_in ?? 3600) * 1000,
  }
}

/**
 * Returns a valid access token, refreshing or prompting for login as needed.
 * Safe to call repeatedly; the result is memoised per process.
 */
export function createTokenProvider(): () => Promise<string> {
  let inFlight: Promise<StoredToken> | null = null

  const load = async (): Promise<StoredToken> => {
    const clientId = await resolveClientId()
    const stored = await readJson<StoredToken>(TOKEN_FILE)

    // 30s buffer so a long upload does not start on a token about to expire.
    if (stored?.accessToken && stored.expiresAt - 30_000 > Date.now()) return stored

    if (stored?.refreshToken) {
      try {
        const token = await exchange({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: stored.refreshToken,
        })
        await persist(token, stored.refreshToken)
        return {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? stored.refreshToken,
          expiresAt: jwtExpiry(token.access_token) ?? Date.now() + (token.expires_in ?? 3600) * 1000,
        }
      } catch (error) {
        warn(`Could not refresh the saved Yoto token, signing in again. (${(error as Error).message})`)
      }
    }

    return interactiveLogin(clientId)
  }

  return async () => {
    const current = await (inFlight ??= load())
    if (current.expiresAt - 30_000 > Date.now()) return current.accessToken
    inFlight = load()
    return (await inFlight).accessToken
  }
}

export async function logout(): Promise<void> {
  await rm(TOKEN_FILE, { force: true })
}

/**
 * Sign in from scratch, always showing the login form so you can choose the
 * account. Use this for an explicit --login; the automatic refresh on expiry
 * deliberately does not force it, so a routine re-auth stays a single click.
 */
export async function forceLogin(): Promise<void> {
  const clientId = await resolveClientId()
  await interactiveLogin(clientId, true)
}

/**
 * The Yoto user the token belongs to. Uploaded media and cards live under that
 * account, so anything cached locally has to be scoped by it: signing in as a
 * different account must not reuse the previous one's media IDs.
 */
export function accountFromToken(token: string): string {
  const payload = token.split('.')[1]
  if (!payload) return 'unknown'
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string }
    return decoded.sub ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export const authPaths = { STORE_DIR, TOKEN_FILE, CONFIG_FILE, REDIRECT_URI, SCOPE }
