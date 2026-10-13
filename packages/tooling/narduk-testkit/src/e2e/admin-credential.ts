/**
 * E2E admin credential: a per-run password for the seeded admin user, stored
 * only as a hash in the LOCAL D1 database the test server reads.
 *
 * No seed file ships a usable password hash, so the shared admin specs
 * (`e2e/specs/users-api`, the admin test in `e2e/contracts/user-profile`) need
 * a password from somewhere. The flow is:
 *
 * 1. `playwright.config.ts` calls {@link ensureE2eAdminPassword} at the top,
 *    before it builds `webServer.env`. The runner process picks a random
 *    password (or keeps one the environment already set) in
 *    `E2E_ADMIN_PASSWORD`. Playwright workers inherit the runner's
 *    environment, so a bare `loginAsAdmin(page)` reads the same value.
 * 2. The `webServer` command runs `narduk-testkit e2e seed-admin --database
 *    <name> --local` AFTER the app's own seed step (the core seed resets the
 *    admin hash to NULL on every run) and BEFORE it starts the server. The
 *    command hashes the password with the same PBKDF2 scheme as narduk-core's
 *    `hashUserPassword()` and writes it with `wrangler d1 execute --local`.
 *
 * The command can only target local state: it requires `--local`, always
 * passes `--local` to wrangler, and refuses `--remote`, `--preview` and any
 * flag it does not know. The password never appears on a command line; the
 * hash goes to wrangler through a temporary file that is removed afterwards.
 *
 * This module must not import `@playwright/test` at runtime: the config and
 * the CLI load it before (and outside) the test runner.
 */

import { webcrypto, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const E2E_ADMIN_PASSWORD_ENV = 'E2E_ADMIN_PASSWORD'
export const E2E_ADMIN_EMAIL_ENV = 'E2E_ADMIN_EMAIL'
/** The admin row narduk-core's `runtime/drizzle/seed.sql` creates. */
export const DEFAULT_E2E_ADMIN_EMAIL = 'admin@example.com'

// Same parameters as narduk-core runtime/server/utils/password.ts. A unit test
// verifies a hash from here with narduk-core's own verifyUserPassword().
const SALT_LENGTH = 16
const ITERATIONS = 100_000
const KEY_LENGTH = 256

/**
 * Make sure `E2E_ADMIN_PASSWORD` is set in `env` and return it. Keeps a value
 * the environment already supplies; otherwise sets a random one. Call it at
 * the top of `playwright.config.ts`, before `webServer.env` copies
 * `process.env`.
 */
export function ensureE2eAdminPassword(env: NodeJS.ProcessEnv = process.env): string {
  const existing = env[E2E_ADMIN_PASSWORD_ENV]
  if (existing) return existing
  const generated = randomBytes(24).toString('base64url')
  env[E2E_ADMIN_PASSWORD_ENV] = generated
  return generated
}

/** The admin email the seed command and `loginAsAdmin` agree on. */
export function resolveE2eAdminEmail(env: NodeJS.ProcessEnv = process.env): string {
  return env[E2E_ADMIN_EMAIL_ENV] || DEFAULT_E2E_ADMIN_EMAIL
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Hash `password` in narduk-core's `salt:hash` (hex, PBKDF2-SHA256) format. */
export async function hashE2eAdminPassword(password: string): Promise<string> {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_LENGTH,
  )
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`
}

const EMAIL_PATTERN = /^[\w.%+-]+@[A-Z0-9.-]+$/i
const HASH_PATTERN = /^[0-9a-f]+:[0-9a-f]+$/
const DATABASE_PATTERN = /^[\w.-]+$/

/** The UPDATE that stores `hash` on the seeded admin row. Inputs are validated, not escaped. */
export function buildSeedAdminSql(email: string, hash: string): string {
  if (!EMAIL_PATTERN.test(email)) throw new Error(`Refusing an unusual admin email: ${email}`)
  if (!HASH_PATTERN.test(hash))
    throw new Error('Refusing a password hash not in salt:hash hex form')
  return `UPDATE users SET password_hash = '${hash}' WHERE email = '${email}' AND is_admin = 1;\n`
}

/** Counts admin rows for `email` that now carry a hash. */
export function buildVerifyAdminSql(email: string): string {
  if (!EMAIL_PATTERN.test(email)) throw new Error(`Refusing an unusual admin email: ${email}`)
  return `SELECT COUNT(*) AS n FROM users WHERE email = '${email}' AND is_admin = 1 AND password_hash IS NOT NULL`
}

export const SEED_ADMIN_USAGE = [
  'Usage:',
  '  narduk-testkit e2e seed-admin --database <name> --local [--config <wrangler config>]',
  '                                [--persist-to <dir>] [--email <address>]',
  '',
  '  Stores a hash of $E2E_ADMIN_PASSWORD on the seeded admin row (default',
  `  $E2E_ADMIN_EMAIL or ${DEFAULT_E2E_ADMIN_EMAIL}) in the LOCAL D1 database.`,
  '  Run it from the app directory after the seed step and before the server',
  '  starts. --local is required; --remote and --preview are refused.',
].join('\n')

export interface SeedAdminArgs {
  database: string
  config?: string
  persistTo?: string
  email?: string
}

/** Parse `seed-admin` flags. Throws on anything that could leave local state. */
export function parseSeedAdminArgs(argv: readonly string[]): SeedAdminArgs {
  let database: string | undefined
  let config: string | undefined
  let persistTo: string | undefined
  let email: string | undefined
  let local = false
  const valueOf = (flag: string, index: number) => {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!
    const [flag, inline] = raw.includes('=')
      ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)]
      : [raw, undefined]
    const take = () => {
      if (inline !== undefined) return inline
      const value = valueOf(flag, index)
      index += 1
      return value
    }
    switch (flag) {
      case '--local':
        if (inline !== undefined && inline !== 'true') {
          throw new Error('seed-admin only runs against local D1 state (--local)')
        }
        local = true
        break
      case '--database':
        database = take()
        break
      case '--config':
      case '-c':
        config = take()
        break
      case '--persist-to':
        persistTo = take()
        break
      case '--email':
        email = take()
        break
      case '--remote':
      case '--preview':
        throw new Error(`seed-admin refuses ${flag}: it only writes local D1 state`)
      default:
        throw new Error(`Unknown seed-admin argument: ${raw}`)
    }
  }
  if (!local) throw new Error('seed-admin requires --local: it only writes local D1 state')
  if (!database) throw new Error('seed-admin needs --database <name>')
  if (!DATABASE_PATTERN.test(database))
    throw new Error(`Refusing an unusual database name: ${database}`)
  return { database, config, persistTo, email }
}

export interface SeedAdminSpawnResult {
  error?: Error
  status: number | null
  stdout: string
  stderr: string
}

export interface SeedAdminDeps {
  cwd: string
  env: NodeJS.ProcessEnv
  log: (message: string) => void
  error: (message: string) => void
  /** Runs `wrangler <args>` in `cwd` and captures its output. */
  wrangler: (
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => SeedAdminSpawnResult
  hash?: (password: string) => Promise<string>
}

function localWranglerArgs(args: SeedAdminArgs): string[] {
  return [
    'd1',
    'execute',
    args.database,
    '--local',
    ...(args.config ? ['--config', args.config] : []),
    ...(args.persistTo ? ['--persist-to', args.persistTo] : []),
  ]
}

/** Read the `n` column from `wrangler d1 execute --json` output. */
export function readCountFromWranglerJson(stdout: string): number | undefined {
  const start = stdout.indexOf('[')
  if (start === -1) return undefined
  try {
    const parsed = JSON.parse(stdout.slice(start)) as Array<{ results?: Array<{ n?: unknown }> }>
    const n = parsed[0]?.results?.[0]?.n
    return typeof n === 'number' ? n : undefined
  } catch {
    return undefined
  }
}

/** `narduk-testkit e2e seed-admin <argv>`; resolves to the exit code. */
export async function runSeedAdminCommand(
  argv: readonly string[],
  deps: SeedAdminDeps,
): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') {
    deps.log(SEED_ADMIN_USAGE)
    return 0
  }
  let args: SeedAdminArgs
  try {
    args = parseSeedAdminArgs(argv)
  } catch (error) {
    deps.error(`${(error as Error).message}\n${SEED_ADMIN_USAGE}`)
    return 1
  }
  const password = deps.env[E2E_ADMIN_PASSWORD_ENV]
  if (!password) {
    deps.error(
      `seed-admin needs ${E2E_ADMIN_PASSWORD_ENV} in the environment. Call ensureE2eAdminPassword() ` +
        "from '@narduk-enterprises/narduk-testkit/e2e/admin-credential' at the top of playwright.config.ts, " +
        'or export it yourself.',
    )
    return 1
  }
  const email = args.email || resolveE2eAdminEmail(deps.env)
  const hash = await (deps.hash ?? hashE2eAdminPassword)(password)
  let sql: string
  let verifySql: string
  try {
    sql = buildSeedAdminSql(email, hash)
    verifySql = buildVerifyAdminSql(email)
  } catch (error) {
    deps.error((error as Error).message)
    return 1
  }

  const base = localWranglerArgs(args)
  const dir = mkdtempSync(join(tmpdir(), 'narduk-e2e-admin-'))
  try {
    const file = join(dir, 'seed-admin.sql')
    writeFileSync(file, sql, { mode: 0o600 })
    const update = deps.wrangler([...base, '--file', file], { cwd: deps.cwd, env: deps.env })
    if (update.error || update.status !== 0) {
      deps.error(
        `seed-admin: wrangler d1 execute --local failed (${update.error?.message ?? `exit ${update.status}`})\n${update.stderr}`,
      )
      return 1
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const verify = deps.wrangler([...base, '--json', '--command', verifySql], {
    cwd: deps.cwd,
    env: deps.env,
  })
  const count = verify.status === 0 ? readCountFromWranglerJson(verify.stdout) : undefined
  if (count !== 1) {
    deps.error(
      `seed-admin: expected exactly one admin row for ${email} with a password hash in local ${args.database}, ` +
        `found ${count ?? 'unknown'}. Run the core seed (db:seed:core) first.\n${verify.stderr}`,
    )
    return 1
  }
  deps.log(
    `[e2e] seed-admin: stored an E2E password hash for ${email} in local D1 ${args.database}`,
  )
  return 0
}
