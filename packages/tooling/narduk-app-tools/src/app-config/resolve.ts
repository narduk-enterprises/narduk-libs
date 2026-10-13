/**
 * The one resolver for an app's `Config/cloudflare-app.json` and
 * `Config/project-lifecycle.json` (portal decision D-PORTAL-APP-CONFIG-1).
 *
 * The Operator Portal's app row owns this configuration. The per-repo files are
 * duplicates that are deleted, repo by repo, after tooling can resolve the
 * document from the portal. This module is the EXPAND half of that move: every
 * tool that reads either file goes through here, and a repo that still carries
 * the file behaves exactly as it did before.
 *
 * RESOLUTION ORDER, `NARDUK_APP_CONFIG_SOURCE`:
 *
 *   auto (default)  the local file when it exists (today's behaviour, no
 *                   network), else the portal document.
 *   file            the local file only. A tool that needs the file throws; one
 *                   that tolerates its absence sees `null`, as it always did.
 *   portal          ignore any local file and fetch from the portal. This is how
 *                   a repo proves it can lose its files.
 *
 * FAILURE IS LOUD. A portal fetch with no token, a 401, a 503, a timeout or a
 * malformed answer throws `AppConfigError`; it never falls back to a missing
 * file and never to a stale cache. Only a definitive 404 ("this repo has no such
 * document") reads as absent, and a tool that cannot proceed without the
 * document asks for `required`, which turns that absence into an error too.
 *
 * SYNC AND ASYNC. Most readers are synchronous and a fetch is not. The split is
 * `primeAppConfig` (async, once per process, at the entry point) and
 * `readAppConfigSync` (everywhere else): a local file is read directly, a
 * portal document is read from what this process primed a moment earlier. An
 * unprimed portal read throws; it never guesses. The primed value is this
 * process's own fresh fetch, never a file on disk.
 *
 * THE CREDENTIAL, in this order. (1) `OPERATOR_PORTAL_APP_CONFIG_TOKEN` (the
 * single-purpose `producer:app-config-read` key). (2) In GitHub Actions, the
 * job's OIDC token: with `ACTIONS_ID_TOKEN_REQUEST_URL` and
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN` set (a job that has `permissions: id-token:
 * write`) the resolver asks GitHub for a token whose audience is the portal
 * origin and sends that as the Bearer, so no secret has to be delivered to the
 * repository; the portal admits it only for the token's own `repository` claim.
 * Every credential is read from the environment only: never an argument, never
 * logged, and scrubbed from every error this module raises.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const APP_CONFIG_FILES = ['cloudflare-app.json', 'project-lifecycle.json'] as const
export type AppConfigFile = (typeof APP_CONFIG_FILES)[number]

/** Repo-relative path of each document, as a checkout carries it. */
export const APP_CONFIG_PATHS: Readonly<Record<AppConfigFile, string>> = {
  'cloudflare-app.json': 'Config/cloudflare-app.json',
  'project-lifecycle.json': 'Config/project-lifecycle.json',
}

export const APP_CONFIG_TOKEN_ENV = 'OPERATOR_PORTAL_APP_CONFIG_TOKEN'
export const OIDC_REQUEST_URL_ENV = 'ACTIONS_ID_TOKEN_REQUEST_URL'
export const OIDC_REQUEST_TOKEN_ENV = 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'
export const APP_CONFIG_SOURCE_ENV = 'NARDUK_APP_CONFIG_SOURCE'
export const APP_CONFIG_ORIGIN_ENV = 'OPERATOR_PORTAL_URL'
export const APP_CONFIG_DEFAULT_ORIGIN = 'https://ops.nardukenterprises.com'
export const APP_CONFIG_ROUTE = '/api/estate/app-config'
export const APP_CONFIG_DEFAULT_TIMEOUT_MS = 15_000

export type AppConfigSourceMode = 'auto' | 'file' | 'portal'

/** `app-owned` is the pre-portal value, still accepted while repos carry files. */
export const ACCEPTED_CONTRACT_OWNERSHIP = ['portal-owned', 'app-owned'] as const

export function isAcceptedContractOwnership(value: unknown): boolean {
  return (ACCEPTED_CONTRACT_OWNERSHIP as readonly unknown[]).includes(value)
}

export type AppConfigErrorCode =
  | 'invalid-source'
  | 'invalid-origin'
  | 'no-token'
  | 'oidc'
  | 'no-repo'
  | 'no-root'
  | 'unauthorized'
  | 'not-found'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'bad-response'
  | 'file-missing'
  | 'file-unreadable'
  | 'not-resolved'

/** The one error type this module raises. Its message is already scrubbed. */
export class AppConfigError extends Error {
  readonly code: AppConfigErrorCode
  readonly status: number | undefined

  constructor(code: AppConfigErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'AppConfigError'
    this.code = code
    this.status = status
  }
}

/** The slice of `fetch` the resolver uses, so a test can inject an answer. */
export interface AppConfigFetchResponse {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}
export type AppConfigFetch = (
  url: string,
  init: {
    method: 'GET'
    headers: Record<string, string>
    redirect: 'manual'
    signal: AbortSignal
  },
) => Promise<AppConfigFetchResponse>

export interface ResolvedAppConfig {
  /** The document text exactly as the file holds it, or as the portal served it. */
  text: string
  source: 'file' | 'portal'
  /** Absolute path of the local file, when `source` is `file`. */
  path?: string
  /** `x-app-config-revision`, when `source` is `portal`. */
  revision?: number
}

export interface AppConfigOptions {
  env?: NodeJS.ProcessEnv
  /** The app's `owner/repo`; derived from the environment and checkout when omitted. */
  repo?: string
  fetch?: AppConfigFetch
  timeoutMs?: number
  /** Turn "absent from every source consulted" into an error. */
  required?: boolean
}

export function readSourceMode(env: NodeJS.ProcessEnv = process.env): AppConfigSourceMode {
  const raw = (env[APP_CONFIG_SOURCE_ENV] ?? '').trim().toLowerCase()
  if (raw === '' || raw === 'auto') return 'auto'
  if (raw === 'file' || raw === 'portal') return raw
  throw new AppConfigError(
    'invalid-source',
    `${APP_CONFIG_SOURCE_ENV}=${JSON.stringify(env[APP_CONFIG_SOURCE_ENV])} is not one of auto, file, portal.`,
  )
}

/** Remove the token, and anything shaped like a portal key, from text. */
export function scrubAppConfigSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text
  for (const name of [APP_CONFIG_TOKEN_ENV, OIDC_REQUEST_TOKEN_ENV]) {
    const secret = env[name]?.trim()
    if (secret) out = out.split(secret).join('[redacted]')
  }
  return (
    out
      .replaceAll(/\bnk_[\w-]{6,}/gu, '[redacted]')
      // A GitHub OIDC token is a JWT.
      .replaceAll(/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*/gu, '[redacted]')
  )
}

function localPath(root: string, file: AppConfigFile): string {
  return join(root, APP_CONFIG_PATHS[file])
}

function readLocal(root: string, file: AppConfigFile): ResolvedAppConfig | null {
  const path = localPath(root, file)
  if (!existsSync(path)) return null
  try {
    if (!statSync(path).isFile()) return null
    return { text: readFileSync(path, 'utf8'), source: 'file', path }
  } catch (error) {
    throw new AppConfigError(
      'file-unreadable',
      `${APP_CONFIG_PATHS[file]} exists at ${path} but cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

const fileModeHint = `Set ${APP_CONFIG_SOURCE_ENV}=file to use the repository's own file instead (that needs the file to exist).`

function missingEverywhere(file: AppConfigFile, mode: AppConfigSourceMode): AppConfigError {
  if (mode === 'file') {
    return new AppConfigError(
      'file-missing',
      `${APP_CONFIG_PATHS[file]} does not exist and ${APP_CONFIG_SOURCE_ENV}=file reads only the local file.`,
    )
  }
  return new AppConfigError(
    'not-found',
    `${APP_CONFIG_PATHS[file]} does not exist in the checkout and the portal has no ${file} for this repository.`,
    404,
  )
}

// --- the checkout ---------------------------------------------------------

export interface LocateOptions {
  /** Directories to climb, counting the start. Default: climb to the filesystem root. */
  maxDepth?: number
  /** Stop at the first directory holding `.git`. */
  stopAtGit?: boolean
}

/**
 * The checkout that owns `file`, found by walking up from `start`. When the
 * local file is wanted and found, that directory is the answer (exactly the
 * walk each tool already did). When it is not found, or the mode ignores local
 * files, the answer is the repository root: the nearest directory this process
 * primed, else the nearest holding `.git`. `null` means there is no checkout to
 * ask the portal about.
 */
export function locateAppConfigRoot(
  start: string,
  file: AppConfigFile,
  options: LocateOptions & { env?: NodeJS.ProcessEnv } = {},
): string | null {
  const mode = readSourceMode(options.env)
  const limit = options.maxDepth ?? Number.POSITIVE_INFINITY
  const stopAtGit = options.stopAtGit ?? false
  const ancestors: string[] = []
  let dir = resolve(start)
  for (let depth = 0; depth < limit; depth += 1) {
    ancestors.push(dir)
    if (mode !== 'portal' && existsSync(localPath(dir, file))) return dir
    if (stopAtGit && existsSync(join(dir, '.git'))) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (mode === 'file') return null
  const primed = ancestors.find((candidate) => primedStore.has(storeKey(candidate, file)))
  if (primed) return primed
  return ancestors.find((candidate) => existsSync(join(candidate, '.git'))) ?? null
}

function gitHubSlug(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match =
    /^(?:(?:git\+)?(?:https:\/\/|ssh:\/\/(?:git@)?)github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/u.exec(
      value.trim(),
    )
  return match?.[1]
}

/** `owner/repo` for a checkout: explicit, `GITHUB_REPOSITORY`, `origin`, then package.json. */
export function resolveAppRepoSlug(
  root: string,
  options: { repo?: string; env?: NodeJS.ProcessEnv } = {},
): string | null {
  const env = options.env ?? process.env
  const explicit = options.repo?.trim()
  if (explicit && /^[\w.-]+\/[\w.-]+$/u.test(explicit)) return explicit
  const fromEnv = env.GITHUB_REPOSITORY?.trim()
  if (fromEnv && /^[\w.-]+\/[\w.-]+$/u.test(fromEnv)) return fromEnv
  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const slug = gitHubSlug(origin)
    if (slug) return slug
  } catch {
    // no git, no origin: fall through to package.json
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      repository?: string | { url?: string }
    }
    return (
      gitHubSlug(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? null
    )
  } catch {
    return null
  }
}

// --- the portal -----------------------------------------------------------

function portalOrigin(env: NodeJS.ProcessEnv): string {
  const raw = (env[APP_CONFIG_ORIGIN_ENV] ?? '').trim() || APP_CONFIG_DEFAULT_ORIGIN
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AppConfigError('invalid-origin', `${APP_CONFIG_ORIGIN_ENV} is not a URL.`)
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    // The bearer token only ever travels over TLS.
    throw new AppConfigError('invalid-origin', `${APP_CONFIG_ORIGIN_ENV} must be an https origin.`)
  }
  return url.origin
}

function oidcAvailable(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env[OIDC_REQUEST_URL_ENV]?.trim() && env[OIDC_REQUEST_TOKEN_ENV]?.trim())
}

function noCredentialError(
  file: AppConfigFile,
  slug: string,
  env: NodeJS.ProcessEnv,
): AppConfigError {
  const inActions = env.GITHUB_ACTIONS === 'true'
  const partial = Boolean(env[OIDC_REQUEST_URL_ENV]?.trim() || env[OIDC_REQUEST_TOKEN_ENV]?.trim())
  const oidc =
    inActions || partial
      ? ` In GitHub Actions the job can authenticate with its OIDC token instead, but that needs \`permissions: id-token: write\` on the job (${OIDC_REQUEST_URL_ENV} and ${OIDC_REQUEST_TOKEN_ENV} are not both set here).`
      : ''
  return new AppConfigError(
    'no-token',
    `${file} for ${slug} must come from the portal, and ${APP_CONFIG_TOKEN_ENV} is not set. ` +
      `Provide the producer:app-config-read key in that environment variable.${oidc} ${fileModeHint}`,
  )
}

/**
 * The Bearer for the portal request: the explicit key, else a GitHub OIDC token
 * whose audience is the portal origin (exactly as the request uses it).
 */
async function portalBearer(
  file: AppConfigFile,
  slug: string,
  origin: string,
  env: NodeJS.ProcessEnv,
  doFetch: AppConfigFetch,
  signal: AbortSignal,
): Promise<{ bearer: string; via: 'token' | 'oidc' }> {
  const explicit = env[APP_CONFIG_TOKEN_ENV]?.trim()
  if (explicit) return { bearer: explicit, via: 'token' }
  if (!oidcAvailable(env)) throw noCredentialError(file, slug, env)
  const requestUrl = new URL(env[OIDC_REQUEST_URL_ENV]!.trim())
  // The request URL normally carries `?api-version=...`; `searchParams` appends
  // with `&` then, and starts the query with `?` when there is none.
  requestUrl.searchParams.set('audience', origin)
  const failure = (reason: string): AppConfigError =>
    new AppConfigError(
      'oidc',
      scrubAppConfigSecrets(
        `Could not get a GitHub OIDC token for the portal (${reason}) to read ${file} of ${slug}. ` +
          `The job needs \`permissions: id-token: write\`. ${fileModeHint}`,
        env,
      ),
    )
  let response: AppConfigFetchResponse
  let body: string
  try {
    response = await doFetch(requestUrl.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${env[OIDC_REQUEST_TOKEN_ENV]!.trim()}`,
      },
      redirect: 'manual',
      signal,
    })
    body = response.status === 200 ? await response.text() : ''
  } catch (error) {
    if (signal.aborted) {
      throw new AppConfigError(
        'timeout',
        `GitHub did not answer the OIDC token request for ${file} of ${slug} in time.`,
      )
    }
    throw failure(error instanceof Error ? error.message : String(error))
  }
  if (response.status !== 200) throw failure(`HTTP ${response.status}`)
  let value: unknown
  try {
    value = (JSON.parse(body) as { value?: unknown }).value
  } catch {
    throw failure('the answer is not JSON')
  }
  if (typeof value !== 'string' || value.trim() === '') throw failure('the answer has no token')
  return { bearer: value.trim(), via: 'oidc' }
}

/** One portal fetch. `null` is a definitive 404; everything else wrong throws. */
export async function fetchPortalAppConfig(
  slug: string,
  file: AppConfigFile,
  options: Pick<AppConfigOptions, 'env' | 'fetch' | 'timeoutMs'> = {},
): Promise<ResolvedAppConfig | null> {
  const env = options.env ?? process.env
  if (!env[APP_CONFIG_TOKEN_ENV]?.trim() && !oidcAvailable(env)) {
    throw noCredentialError(file, slug, env)
  }
  const origin = portalOrigin(env)
  const url = new URL(APP_CONFIG_ROUTE, origin)
  url.searchParams.set('repo', slug)
  url.searchParams.set('file', file)
  const doFetch: AppConfigFetch = options.fetch ?? ((u, init) => fetch(u, init))
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? APP_CONFIG_DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const { bearer, via } = await portalBearer(file, slug, origin, env, doFetch, controller.signal)
    const credential = via === 'oidc' ? 'the GitHub OIDC token' : APP_CONFIG_TOKEN_ENV
    let response: AppConfigFetchResponse
    let body: string
    try {
      response = await doFetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
        redirect: 'manual',
        signal: controller.signal,
      })
      body = response.status === 200 ? await response.text() : ''
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppConfigError(
          'timeout',
          `The portal did not answer for ${file} of ${slug} within ${timeoutMs} ms.`,
        )
      }
      if (error instanceof AppConfigError) throw error
      throw new AppConfigError(
        'network',
        scrubAppConfigSecrets(
          `Could not reach the portal for ${file} of ${slug}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          env,
        )
          .split(bearer)
          .join('[redacted]'),
      )
    }
    const status = response.status
    if (status === 401 || status === 403) {
      throw new AppConfigError(
        'unauthorized',
        `The portal refused ${credential} for ${file} of ${slug} (HTTP ${status}). ` +
          (via === 'oidc'
            ? 'The portal admits an OIDC token only for the repository in its own claim, and only for the app it is linked to.'
            : 'It must be the single-purpose producer:app-config-read key.'),
        status,
      )
    }
    if (status === 404) return null
    if (status === 503) {
      throw new AppConfigError(
        'unavailable',
        `The portal's app registry is unavailable (HTTP 503) for ${file} of ${slug}. Retry; nothing was read from a file or a cache.`,
        status,
      )
    }
    if (status !== 200) {
      throw new AppConfigError(
        'bad-response',
        `The portal answered HTTP ${status} for ${file} of ${slug}.`,
        status,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new AppConfigError(
        'bad-response',
        `The portal's ${file} for ${slug} is not valid JSON.`,
      )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppConfigError(
        'bad-response',
        `The portal's ${file} for ${slug} is not a JSON object.`,
      )
    }
    const ownership = (parsed as Record<string, unknown>).contractOwnership
    if (ownership !== undefined && !isAcceptedContractOwnership(ownership)) {
      throw new AppConfigError(
        'bad-response',
        `The portal's ${file} for ${slug} declares contractOwnership ${JSON.stringify(ownership)}; expected "portal-owned".`,
      )
    }
    const revisionText = response.headers.get('x-app-config-revision')
    const revision =
      revisionText !== null && /^\d+$/u.test(revisionText) ? Number(revisionText) : undefined
    return { text: body, source: 'portal', ...(revision === undefined ? {} : { revision }) }
  } finally {
    clearTimeout(timer)
  }
}

// --- async resolution -----------------------------------------------------

export interface ResolveAppConfigOptions extends AppConfigOptions {
  /** The checkout root (exact: nothing above it is consulted). */
  root: string
  file: AppConfigFile
}

/**
 * Resolve one document. `null` means absent from every source this mode
 * consults (and `required` was not set). Never reads a primed value.
 */
export async function resolveAppConfig(
  options: ResolveAppConfigOptions,
): Promise<ResolvedAppConfig | null> {
  const env = options.env ?? process.env
  const mode = readSourceMode(env)
  if (mode !== 'portal') {
    const local = readLocal(options.root, options.file)
    if (local) return local
    if (mode === 'file') {
      if (options.required) throw missingEverywhere(options.file, mode)
      return null
    }
  }
  const slug = resolveAppRepoSlug(options.root, { ...options, env })
  if (!slug) {
    throw new AppConfigError(
      'no-repo',
      `${APP_CONFIG_PATHS[options.file]} is not in ${options.root} and its GitHub repository could not be determined ` +
        `(no GITHUB_REPOSITORY, no origin remote, no package.json repository), so the portal cannot be asked. ${fileModeHint}`,
    )
  }
  const fetched = await fetchPortalAppConfig(slug, options.file, { ...options, env })
  if (fetched === null && options.required) throw missingEverywhere(options.file, mode)
  return fetched
}

// --- sync reads of what this process primed -------------------------------

type PrimedEntry = ResolvedAppConfig | null
const primedStore = new Map<string, PrimedEntry>()

function storeKey(root: string, file: AppConfigFile): string {
  return `${resolve(root)}\u0000${file}`
}

/** Forget every primed document (tests; a long-lived process re-primes). */
export function clearPrimedAppConfig(): void {
  primedStore.clear()
}

export interface PrimeAppConfigOptions extends AppConfigOptions, LocateOptions {
  /** Where to start looking for the checkout. */
  dir: string
  files: readonly AppConfigFile[]
  /** `dir` IS the checkout root: do not walk, and do not require `.git`. */
  exact?: boolean
}

/**
 * Resolve the documents a command is about to read synchronously. A local file
 * needs no network and is not stored (the sync read re-reads it); a portal
 * document is fetched and kept for `readAppConfigSync`. Throws on any failure
 * other than a 404, and on a 404 too when `required`.
 */
export async function primeAppConfig(options: PrimeAppConfigOptions): Promise<void> {
  const env = options.env ?? process.env
  const mode = readSourceMode(env)
  for (const file of options.files) {
    const root = options.exact
      ? resolve(options.dir)
      : locateAppConfigRoot(options.dir, file, { ...options, env })
    if (root === null) {
      if (mode === 'file') {
        if (options.required) throw missingEverywhere(file, mode)
        continue
      }
      throw new AppConfigError(
        'no-root',
        `${APP_CONFIG_PATHS[file]} is not found from ${resolve(options.dir)} and no git checkout contains it, so there is no repository to ask the portal about. ${fileModeHint}`,
      )
    }
    const resolved = await resolveAppConfig({ ...options, env, root, file })
    if (resolved && resolved.source === 'file') continue
    primedStore.set(storeKey(root, file), resolved)
  }
}

export interface ReadAppConfigOptions extends Pick<AppConfigOptions, 'env' | 'required'> {
  /** The checkout root (exact). */
  root: string
  file: AppConfigFile
}

/**
 * Read one document without awaiting: the local file when the mode allows it,
 * else what `primeAppConfig` fetched. An unprimed portal read throws rather
 * than reporting "absent".
 */
export function readAppConfigSync(options: ReadAppConfigOptions): ResolvedAppConfig | null {
  const env = options.env ?? process.env
  const mode = readSourceMode(env)
  if (mode !== 'portal') {
    const local = readLocal(options.root, options.file)
    if (local) return local
    if (mode === 'file') {
      if (options.required) throw missingEverywhere(options.file, mode)
      return null
    }
  }
  const key = storeKey(options.root, options.file)
  if (!primedStore.has(key)) {
    throw new AppConfigError(
      'not-resolved',
      `${APP_CONFIG_PATHS[options.file]} is not in ${options.root} and its portal copy was not resolved before this read ` +
        `(call primeAppConfig first). ${fileModeHint}`,
    )
  }
  const primed = primedStore.get(key) ?? null
  if (primed === null && options.required) throw missingEverywhere(options.file, mode)
  return primed
}

/** The document text, or null; the shape most call sites want. */
export function readAppConfigText(options: ReadAppConfigOptions): string | null {
  return readAppConfigSync(options)?.text ?? null
}

/** Prime both documents of a checkout whose root is already known. */
export async function primeAppCheckoutConfig(
  root: string,
  options: Pick<AppConfigOptions, 'env' | 'fetch' | 'timeoutMs' | 'repo'> = {},
): Promise<void> {
  await primeAppConfig({ ...options, dir: root, exact: true, files: APP_CONFIG_FILES })
}

/**
 * {@link locateAppConfigRoot}, for a tool that cannot proceed without the
 * document: no checkout to read it from is an error, never an absence.
 */
export function requireAppConfigRoot(
  start: string,
  file: AppConfigFile,
  options: LocateOptions & { env?: NodeJS.ProcessEnv } = {},
): string {
  const root = locateAppConfigRoot(start, file, options)
  if (root !== null) return root
  const mode = readSourceMode(options.env)
  if (mode === 'file') throw missingEverywhere(file, mode)
  throw new AppConfigError(
    'no-root',
    `${APP_CONFIG_PATHS[file]} is not found from ${resolve(start)} and no git checkout contains it, so there is no repository to ask the portal about. ${fileModeHint}`,
  )
}
