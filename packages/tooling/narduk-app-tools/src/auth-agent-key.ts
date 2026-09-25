import { spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { spawnWranglerSync } from './package-manager.js'
import {
  buildWranglerD1ExecuteArgs,
  parseWranglerJson,
  type MigrationLocation,
} from './migrations.js'

/**
 * `narduk-app auth agent-key create` (narduk-libs#782).
 *
 * Gives an agent an API key on a narduk-auth app without hand-written D1 SQL.
 * The key belongs to its own non-login user (no password, an undeliverable
 * `.invalid` address, so there is no way to sign in or reset one), never to an
 * owner's account.
 *
 * The raw key is minted in this process and leaves it only on the secret
 * sink's stdin (the command after `--`, e.g. the estate's guarded nvault
 * setter) and in the proof request's Authorization header. It never reaches
 * argv, stdout, stderr or a file; D1 receives its SHA-256 hash, as narduk-core
 * `generateApiKey` stores it.
 *
 * Order: deliver to the sink first, then write D1, then prove. A sink failure
 * leaves nothing in D1; a D1 failure leaves an inert value in the sink that no
 * row makes live.
 */

export const API_KEY_PREFIX = 'nk_'
/** Mirrors narduk-core's `generateApiKey`: `nk_` + 8 hex characters. */
const KEY_PREFIX_LENGTH = 11
const AGENT_EMAIL_DOMAIN = 'agents.invalid'
const MAX_EXPIRES_DAYS = 3650
/** GET /api/auth/api-keys is API-key capable; `/api/auth/me` is session-only. */
export const AGENT_KEY_PROOF_PATH = '/api/auth/api-keys'

export const AGENT_KEY_USAGE = [
  'Usage: narduk-app auth agent-key create --database <name> --local|--remote',
  '         --name <label> --scopes <scope[,scope...]> --expires-days <n>',
  '         [--admin] [--email <address>] [--wrangler-config <file>]',
  '         (--app-url <origin> | --no-proof) -- <secret sink command...>',
  '',
  'Creates a non-login user and an API key for it. The key is written only to the',
  "sink command's stdin (for example the guarded nvault setter), never to argv,",
  'stdout or a file; D1 stores its SHA-256 hash. --app-url proves the key with an',
  `authenticated GET ${AGENT_KEY_PROOF_PATH} (a 401 without it, and not 401 with it).`,
].join('\n')

export interface AgentKeyCreateFlags {
  admin: boolean
  appUrl: string | null
  cwd: string
  database: string
  email: string | null
  expiresDays: number
  location: MigrationLocation
  name: string
  scopes: string[]
  sink: { args: string[]; command: string }
  wranglerConfig?: string
}

function takeValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parseScopes(value: string): string[] {
  const scopes = [
    ...new Set(
      value
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ]
  if (scopes.length === 0) {
    throw new Error(
      '--scopes needs at least one scope; an unscoped key passes every unscoped route',
    )
  }
  return scopes
}

function parseExpiresDays(value: string): number {
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
    throw new Error(`--expires-days must be a whole number from 1 to ${MAX_EXPIRES_DAYS}`)
  }
  return days
}

function parseAppUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`--app-url is not a URL: ${value}`)
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('--app-url must be https (or http on localhost): the proof sends the key')
  }
  return url.origin
}

interface ParseState {
  admin: boolean
  appUrl?: string
  database?: string
  email?: string
  expiresDays?: number
  location?: MigrationLocation
  name?: string
  noProof: boolean
  scopes?: string[]
  wranglerConfig?: string
}

const VALUE_FLAGS: Record<string, (state: ParseState, value: string) => void> = {
  '--app-url': (state, value) => (state.appUrl = parseAppUrl(value)),
  '--database': (state, value) => (state.database = value),
  '--email': (state, value) => (state.email = value.trim().toLowerCase()),
  '--expires-days': (state, value) => (state.expiresDays = parseExpiresDays(value)),
  '--name': (state, value) => (state.name = value.trim()),
  '--scopes': (state, value) => (state.scopes = parseScopes(value)),
  '--wrangler-config': (state, value) => (state.wranglerConfig = value),
}

function setLocation(state: ParseState, location: MigrationLocation) {
  if (state.location && state.location !== location) {
    throw new Error('Pass exactly one of --local or --remote')
  }
  state.location = location
}

export function parseAgentKeyCreateArgs(
  args: readonly string[],
  cwd = process.cwd(),
): AgentKeyCreateFlags {
  const separator = args.indexOf('--')
  const own = separator === -1 ? args : args.slice(0, separator)
  const sink = separator === -1 ? [] : args.slice(separator + 1)
  const state: ParseState = { admin: false, noProof: false }

  for (let index = 0; index < own.length; index += 1) {
    const flag = own[index]!
    const setter = VALUE_FLAGS[flag]
    if (setter) {
      setter(state, takeValue(own, index, flag))
      index += 1
    } else if (flag === '--local' || flag === '--remote') {
      setLocation(state, flag)
    } else if (flag === '--admin') {
      state.admin = true
    } else if (flag === '--no-proof') {
      state.noProof = true
    } else {
      throw new Error(`Unknown option: ${flag}\n\n${AGENT_KEY_USAGE}`)
    }
  }

  const missing = [
    ['--database', state.database],
    ['--local or --remote', state.location],
    ['--name', state.name],
    ['--scopes', state.scopes],
    ['--expires-days', state.expiresDays],
  ]
    .filter(([, value]) => value === undefined || value === '')
    .map(([flag]) => flag)
  if (missing.length > 0) throw new Error(`Missing ${missing.join(', ')}\n\n${AGENT_KEY_USAGE}`)
  if (sink.length === 0 || !sink[0]) {
    throw new Error(
      'Name the secret sink after `--`: the key is written only to its stdin.\n\n' +
        AGENT_KEY_USAGE,
    )
  }
  if (Boolean(state.appUrl) === state.noProof) {
    throw new Error('Pass exactly one of --app-url <origin> (prove the key) or --no-proof')
  }
  if (state.email !== undefined && !/^[^\s@]+@[^\s@]+$/u.test(state.email)) {
    throw new Error(`--email is not an address: ${state.email}`)
  }

  return {
    admin: state.admin,
    appUrl: state.appUrl ?? null,
    cwd,
    database: state.database!,
    email: state.email ?? null,
    expiresDays: state.expiresDays!,
    location: state.location!,
    name: state.name!,
    scopes: state.scopes!,
    sink: { command: sink[0], args: sink.slice(1) },
    ...(state.wranglerConfig ? { wranglerConfig: state.wranglerConfig } : {}),
  }
}

export interface MintedAgentKey {
  keyHash: string
  keyPrefix: string
  rawKey: string
}

/** The same key format and hash as narduk-core `generateApiKey`. */
export function mintAgentKey(): MintedAgentKey {
  const rawKey = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`
  return {
    rawKey,
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
  }
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-+|-+$/gu, '')
      .slice(0, 40) || 'agent'
  )
}

export interface AgentKeyRecord {
  createdAt: string
  email: string
  expiresAt: number
  keyId: string
  keyPrefix: string
  name: string
  scopes: string[]
  userId: string
}

/**
 * The users and api_keys rows. The `users` timestamps have no SQL default
 * (drizzle fills them in the app), so they are written explicitly — the
 * `NOT NULL constraint failed: users.created_at` that hand SQL hit.
 */
export function buildAgentKeySql(record: AgentKeyRecord, keyHash: string, admin: boolean): string {
  const userSql =
    'INSERT INTO users (id, email, password_hash, name, is_admin, created_at, updated_at) VALUES (' +
    [
      sqlText(record.userId),
      sqlText(record.email),
      'NULL',
      sqlText(record.name),
      admin ? '1' : '0',
      sqlText(record.createdAt),
      sqlText(record.createdAt),
    ].join(', ') +
    ');'
  const keySql =
    'INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes_json, expires_at, created_at) VALUES (' +
    [
      sqlText(record.keyId),
      sqlText(record.userId),
      sqlText(record.name),
      sqlText(keyHash),
      sqlText(record.keyPrefix),
      sqlText(JSON.stringify(record.scopes)),
      String(record.expiresAt),
      sqlText(record.createdAt),
    ].join(', ') +
    ');'
  return `${userSql}\n${keySql}`
}

export type AgentKeyD1Executor = (args: string[], cwd: string) => string
export type AgentKeySinkRunner = (
  command: string,
  args: readonly string[],
  input: string,
) => { error?: Error; status: number | null }
export type AgentKeyFetch = (
  url: string,
  init: { headers: Record<string, string>; method: 'GET' },
) => Promise<{ status: number; text(): Promise<string> }>

export interface AgentKeyDependencies {
  executeD1: AgentKeyD1Executor
  fetch: AgentKeyFetch
  mint: () => MintedAgentKey
  now: () => Date
  runSink: AgentKeySinkRunner
}

function defaultExecuteD1(args: string[], cwd: string): string {
  const result = spawnWranglerSync(cwd, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw new Error(`Could not run wrangler: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `wrangler exited ${result.status}`).trim())
  }
  return result.stdout
}

function defaultRunSink(command: string, args: readonly string[], input: string) {
  // stdin carries the key; the sink's own output is its business, not ours.
  const result = spawnSync(command, [...args], { input, stdio: ['pipe', 'inherit', 'inherit'] })
  return { status: result.status, ...(result.error ? { error: result.error } : {}) }
}

export const defaultAgentKeyDependencies: AgentKeyDependencies = {
  executeD1: defaultExecuteD1,
  fetch: (url, init) => fetch(url, init),
  mint: mintAgentKey,
  now: () => new Date(),
  runSink: defaultRunSink,
}

export interface AgentKeyProof {
  anonymousStatus: number
  keyStatus: number
  url: string
}

export interface AgentKeyCreateResult extends AgentKeyRecord {
  admin: boolean
  proof: AgentKeyProof | 'skipped'
}

async function proveAgentKey(
  appUrl: string,
  rawKey: string,
  fetchImpl: AgentKeyFetch,
): Promise<AgentKeyProof> {
  const url = `${appUrl}${AGENT_KEY_PROOF_PATH}`
  const headers = { accept: 'application/json' }
  const anonymous = await fetchImpl(url, { method: 'GET', headers })
  const withKey = await fetchImpl(url, {
    method: 'GET',
    headers: { ...headers, authorization: `Bearer ${rawKey}` },
  })
  const proof = { anonymousStatus: anonymous.status, keyStatus: withKey.status, url }
  // 401 without the key shows the route authenticates at all; with the key,
  // 200 lists it, and 403 means it authenticated but lacks auth:api-keys:read.
  const authenticated =
    withKey.status === 200 ||
    (withKey.status === 403 && /missing required API key scopes/iu.test(await withKey.text()))
  if (anonymous.status !== 401 || !authenticated) {
    throw new Error(
      `The key was created but its proof failed: GET ${url} answered ${anonymous.status} ` +
        `without the key (expected 401) and ${withKey.status} with it (expected 200, or 403 ` +
        'for a key without auth:api-keys:read). Check --app-url and --database point at ' +
        'the same app before trusting the key.',
    )
  }
  return proof
}

export async function runAgentKeyCreate(
  flags: AgentKeyCreateFlags,
  dependencies: AgentKeyDependencies = defaultAgentKeyDependencies,
): Promise<AgentKeyCreateResult> {
  const minted = dependencies.mint()
  const createdAt = dependencies.now().toISOString()
  const userId = randomUUID()
  const record: AgentKeyRecord = {
    createdAt,
    email: flags.email ?? `agent-${slug(flags.name)}-${userId.slice(0, 8)}@${AGENT_EMAIL_DOMAIN}`,
    expiresAt: Math.floor(dependencies.now().getTime() / 1000) + flags.expiresDays * 86_400,
    keyId: randomUUID(),
    keyPrefix: minted.keyPrefix,
    name: flags.name,
    scopes: flags.scopes,
    userId,
  }

  const sink = dependencies.runSink(flags.sink.command, flags.sink.args, minted.rawKey)
  if (sink.error || sink.status !== 0) {
    throw new Error(
      `The secret sink \`${flags.sink.command}\` failed ` +
        `(${sink.error ? sink.error.message : `exit ${sink.status}`}); nothing was written to D1.`,
    )
  }

  const sql = buildAgentKeySql(record, minted.keyHash, flags.admin)
  const cwd = resolve(flags.cwd)
  const args = buildWranglerD1ExecuteArgs({
    database: flags.database,
    location: flags.location,
    sql,
    json: true,
  })
  if (flags.wranglerConfig) args.push('--config', resolve(cwd, flags.wranglerConfig))
  try {
    // Every statement's entry must report success (one batch, so all or none).
    parseWranglerJson(dependencies.executeD1(args, cwd))
  } catch (error) {
    throw new Error(
      `D1 refused the agent user or key (${error instanceof Error ? error.message : String(error)}). ` +
        'The value already handed to the sink is not live: no api_keys row carries its hash.',
    )
  }

  const proof = flags.appUrl
    ? await proveAgentKey(flags.appUrl, minted.rawKey, dependencies.fetch)
    : 'skipped'
  return { ...record, admin: flags.admin, proof }
}

export function formatAgentKeyCreateResult(result: AgentKeyCreateResult): string {
  const lines = [
    `Created agent user ${result.userId} (${result.email})${result.admin ? ' [admin]' : ''}`,
    `API key ${result.keyId} ${result.keyPrefix}… "${result.name}"`,
    `  scopes: ${result.scopes.join(', ')}`,
    `  expires: ${new Date(result.expiresAt * 1000).toISOString()}`,
    '  value: delivered to the secret sink only',
  ]
  lines.push(
    result.proof === 'skipped'
      ? '  proof: skipped (--no-proof)'
      : `  proof: GET ${result.proof.url} -> ${result.proof.anonymousStatus} without the key, ${result.proof.keyStatus} with it`,
  )
  return lines.join('\n')
}
