/**
 * `narduk-app db create` -- create the one D1 database a scaffold's placeholder
 * binding stands for, and write its id back (narduk-libs#662).
 *
 * `create-narduk-app` emits a `DB` binding whose `database_id` is the all-zero
 * UUID: the generator must not call Cloudflare, so it cannot know the real id.
 * That placeholder is syntactically valid, so `nuxt build`, `wrangler deploy
 * --dry-run` and every test accept it, and the first evidence the database does
 * not exist used to be a failed request against a deployed Worker.
 * `foundation:check` sub-check 1.5 now fails while the placeholder is in place;
 * this command is the one step that clears it.
 *
 * The rules, each one a refusal rather than a guess:
 *
 * 1. **Only a placeholder is replaced.** A binding whose `database_id` is any
 *    other value is already provisioned, and the command exits without calling
 *    Wrangler. Creating is cheap to authorize; a second database that quietly
 *    takes writes is not.
 * 2. **The name comes from `Config/cloudflare-app.json`, never an argument.**
 *    The manifest's `bindings.d1[]` entry may name the database
 *    (`database_name`); otherwise it is `<worker.name>-<binding>`, Wrangler's
 *    own auto-provisioning convention and the name the generator writes
 *    (`<app>-db` for `DB`). The wrangler config must already agree, so the name
 *    cannot diverge from the manifest.
 * 3. **The account is explicit.** Wrangler picks an account on its own when a
 *    token reaches several, and prompts or guesses when none is named. The
 *    command requires `account_id` in the wrangler config or
 *    `CLOUDFLARE_ACCOUNT_ID`, refuses when both are set and disagree, and prints
 *    the account it used -- the id is configuration, not a secret.
 * 4. **The write preserves the file.** The returned id is written into the
 *    wrangler config the manifest names (`worker.wranglerConfig`) with a
 *    `jsonc-parser` edit, so comments and formatting survive. If the file
 *    changed while Wrangler ran, nothing is written and the id is printed for
 *    the operator to record.
 * 5. **It never deletes.** A D1 database is a data store; removing one is an
 *    operator action, not a tool's. Nothing here calls `d1 delete`.
 *
 * Credentials are Wrangler's own, exactly as `db migrate --remote` uses them:
 * `CLOUDFLARE_API_TOKEN` (or a `wrangler login` session) from the environment.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser'

import { CLOUDFLARE_APP_MANIFEST } from './database-ownership.js'
import { spawnWranglerSync } from './package-manager.js'

/** The id `create-narduk-app` writes for a D1 binding it cannot provision. */
export const PLACEHOLDER_D1_DATABASE_ID = '00000000-0000-0000-0000-000000000000'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATABASE_ID_IN_OUTPUT = /["']?database_id["']?\s*[:=]\s*["']([0-9a-f-]{36})["']/gi

export function isPlaceholderD1DatabaseId(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === PLACEHOLDER_D1_DATABASE_ID
}

/** `<worker>-<binding>`, lower-case, `_` as `-`: the name Wrangler's own
 * auto-provisioning gives a binding, and the one the generator writes. */
export function conventionalD1DatabaseName(workerName: string, binding: string): string {
  return `${workerName}-${binding.toLowerCase().replaceAll('_', '-')}`
}

/** What `wrangler d1 create <name>` was asked to make, and where the id goes. */
export interface D1CreatePlan {
  checkoutDir: string
  /** The wrangler config the manifest names, absolute. */
  wranglerConfigPath: string
  /** The same path relative to the checkout, for messages. */
  wranglerConfig: string
  binding: string
  /** Index of the binding in the top-level `d1_databases` array. */
  index: number
  databaseName: string
  /** The account Wrangler is pointed at. Passed to Wrangler, never printed. */
  accountId: string
  accountSource: 'wrangler config account_id' | 'CLOUDFLARE_ACCOUNT_ID'
  /**
   * The account id as the wrangler config states it, or null when it came from
   * `CLOUDFLARE_ACCOUNT_ID`. Messages and results show only this one: an
   * account id is not a credential, but a value read from the environment is
   * not echoed to the terminal or into logs.
   */
  configAccountId: string | null
  /** The config text the plan was made from; the write refuses if it changed. */
  wranglerText: string
}

export interface D1CreateOptions {
  checkoutDir: string
  /** Required only when more than one top-level D1 binding is a placeholder. */
  binding?: string
  dryRun?: boolean
  env?: NodeJS.ProcessEnv
}

export interface D1CreateResult {
  status: 'created' | 'dry-run'
  binding: string
  databaseName: string
  databaseId: string | null
  /** The config's `account_id`, or null when the account came from `CLOUDFLARE_ACCOUNT_ID`. */
  accountId: string | null
  accountSource: D1CreatePlan['accountSource']
  wranglerConfig: string
}

/**
 * Runs Wrangler and returns its stdout; throws when it fails. Injectable at
 * the process boundary, the same seam `db migrate`'s `MigrationExecutor` is,
 * so the whole command is testable without a Cloudflare account.
 */
export type D1CreateExecutor = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => string

export const runWranglerForD1Create: D1CreateExecutor = (args, cwd, env) => {
  const result = spawnWranglerSync(cwd, args, {
    cwd,
    encoding: 'utf8',
    env,
    // stdin closed: Wrangler then never prompts, and in particular never
    // offers to edit the config itself. This command owns that write.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw new Error(`Could not run wrangler: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `wrangler exited ${result.status}`).trim())
  }
  return `${result.stdout}\n${result.stderr}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsoncText(text: string, path: string): unknown {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(', ')
    throw new Error(`Could not parse ${path}: ${details}`)
  }
  return value
}

function readText(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw new Error(`db create: cannot read ${what} at ${path}`)
  }
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Everything the command can decide without calling Wrangler. Throws with the
 * reason on every refusal; returns a plan only when creating is the right step. */
export function planD1Create(options: D1CreateOptions): D1CreatePlan {
  const checkoutDir = resolve(options.checkoutDir)
  const env = options.env ?? process.env
  const manifestPath = join(checkoutDir, CLOUDFLARE_APP_MANIFEST)
  const manifest = parseJsoncText(
    readText(manifestPath, `${CLOUDFLARE_APP_MANIFEST} (the database name comes from it)`),
    manifestPath,
  )
  if (!isRecord(manifest) || !isRecord(manifest.worker)) {
    throw new Error(`db create: ${CLOUDFLARE_APP_MANIFEST} has no "worker" block`)
  }
  const workerName = nonEmpty(manifest.worker.name)
  if (!workerName) throw new Error(`db create: ${CLOUDFLARE_APP_MANIFEST} has no worker.name`)
  const wranglerRel = nonEmpty(manifest.worker.wranglerConfig)
  if (!wranglerRel) {
    throw new Error(
      `db create: ${CLOUDFLARE_APP_MANIFEST} has no worker.wranglerConfig naming the wrangler ` +
        'config to write the database id into',
    )
  }
  if (isAbsolute(wranglerRel) || wranglerRel.split(/[\\/]/).includes('..')) {
    throw new Error(
      `db create: worker.wranglerConfig ${JSON.stringify(wranglerRel)} must be a path inside ` +
        'the checkout',
    )
  }
  if (!/\.jsonc?$/.test(wranglerRel)) {
    throw new Error(
      `db create: ${wranglerRel} is not a JSON/JSONC wrangler config; this command writes ` +
        'only wrangler.json / wrangler.jsonc',
    )
  }
  const wranglerConfigPath = join(checkoutDir, wranglerRel)
  const wranglerText = readText(wranglerConfigPath, 'the wrangler config')
  const wrangler = parseJsoncText(wranglerText, wranglerConfigPath)
  if (!isRecord(wrangler)) throw new Error(`db create: ${wranglerRel} is not a JSON object`)

  const entries = Array.isArray(wrangler.d1_databases) ? wrangler.d1_databases : []
  const bindings = entries.map((entry, index) => ({
    index,
    binding: isRecord(entry) ? nonEmpty(entry.binding) : null,
    databaseId: isRecord(entry) ? entry.database_id : undefined,
    databaseName: isRecord(entry) ? nonEmpty(entry.database_name) : null,
  }))
  if (bindings.length === 0) {
    throw new Error(`db create: ${wranglerRel} declares no top-level d1_databases binding`)
  }

  let target: (typeof bindings)[number] | undefined
  if (options.binding) {
    target = bindings.find((entry) => entry.binding === options.binding)
    if (!target) {
      throw new Error(
        `db create: ${wranglerRel} has no top-level d1_databases binding ` +
          `${JSON.stringify(options.binding)}`,
      )
    }
  } else {
    const placeholders = bindings.filter((entry) => isPlaceholderD1DatabaseId(entry.databaseId))
    if (placeholders.length === 0) {
      throw new Error(
        `db create: refused -- no D1 binding in ${wranglerRel} still carries the placeholder ` +
          `database_id ${PLACEHOLDER_D1_DATABASE_ID}. Every database is already provisioned; ` +
          'creating another would leave one of them taking no traffic, or both taking writes.',
      )
    }
    if (placeholders.length > 1) {
      throw new Error(
        `db create: ${placeholders.length} D1 bindings in ${wranglerRel} carry the placeholder ` +
          `id (${placeholders.map((entry) => entry.binding ?? `#${entry.index}`).join(', ')}); ` +
          'choose one with --binding <NAME>',
      )
    }
    target = placeholders[0]
  }
  const binding = target.binding
  if (!binding) throw new Error(`db create: d1_databases[${target.index}] has no binding name`)
  if (!isPlaceholderD1DatabaseId(target.databaseId)) {
    throw new Error(
      `db create: refused -- binding ${binding} in ${wranglerRel} already names database ` +
        `${JSON.stringify(target.databaseId)}. Only the placeholder ` +
        `${PLACEHOLDER_D1_DATABASE_ID} is replaced; a real id is never overwritten.`,
    )
  }

  const mirror = isRecord(manifest.bindings) && Array.isArray(manifest.bindings.d1)
  const mirrored = mirror
    ? (manifest.bindings as { d1: unknown[] }).d1.find(
        (entry) => isRecord(entry) && entry.binding === binding,
      )
    : undefined
  if (!isRecord(mirrored)) {
    throw new Error(
      `db create: binding ${binding} is not declared in ${CLOUDFLARE_APP_MANIFEST} ` +
        'bindings.d1, which is where its database name comes from. Mirror it there first ' +
        '(foundation:check item 1.2 requires the same).',
    )
  }
  const databaseName =
    nonEmpty(mirrored.database_name) ??
    nonEmpty(mirrored.databaseName) ??
    conventionalD1DatabaseName(workerName, binding)
  if (target.databaseName !== databaseName) {
    throw new Error(
      `db create: refused -- ${CLOUDFLARE_APP_MANIFEST} names binding ${binding}'s database ` +
        `${JSON.stringify(databaseName)}, but ${wranglerRel} says ` +
        `${JSON.stringify(target.databaseName)}. Make them agree first; the name is taken from ` +
        'the manifest so the two cannot diverge.',
    )
  }

  const configAccount = nonEmpty(wrangler.account_id)
  const envAccount = nonEmpty(env.CLOUDFLARE_ACCOUNT_ID)
  if (configAccount && envAccount && configAccount !== envAccount) {
    throw new Error(
      `db create: refused -- ${wranglerRel} account_id ${configAccount} and ` +
        'CLOUDFLARE_ACCOUNT_ID disagree about which account the database belongs in',
    )
  }
  const accountId = configAccount ?? envAccount
  if (!accountId) {
    throw new Error(
      'db create: refused -- no Cloudflare account named. Set CLOUDFLARE_ACCOUNT_ID (or ' +
        `account_id in ${wranglerRel}) to the account the database belongs in; Wrangler ` +
        'would otherwise pick one on its own.',
    )
  }

  return {
    checkoutDir,
    wranglerConfigPath,
    wranglerConfig: relative(checkoutDir, wranglerConfigPath),
    binding,
    index: target.index,
    databaseName,
    accountId,
    accountSource: configAccount ? 'wrangler config account_id' : 'CLOUDFLARE_ACCOUNT_ID',
    configAccountId: configAccount ?? null,
    wranglerText,
  }
}

export function buildWranglerD1CreateArgs(plan: D1CreatePlan): string[] {
  return ['d1', 'create', plan.databaseName, '--config', plan.wranglerConfigPath]
}

/**
 * The id `wrangler d1 create` reports. Wrangler 4 has no `--json` for this
 * command; it prints a config snippet (JSON for a JSON config, TOML otherwise)
 * whose `database_id` is the new database's UUID. Exactly one distinct UUID
 * must appear, or the output is refused rather than guessed at.
 */
export function parseD1CreateOutput(output: string): string {
  const ids = new Set<string>()
  for (const match of output.matchAll(DATABASE_ID_IN_OUTPUT)) {
    const id = match[1]!.toLowerCase()
    if (UUID_PATTERN.test(id)) ids.add(id)
  }
  ids.delete(PLACEHOLDER_D1_DATABASE_ID)
  if (ids.size !== 1) {
    throw new Error(
      ids.size === 0
        ? 'wrangler d1 create reported no database_id'
        : `wrangler d1 create reported ${ids.size} different database ids: ${[...ids].join(', ')}`,
    )
  }
  return [...ids][0]!
}

/** The config text with `d1_databases[index].database_id` set to `id`, every
 * comment and all other formatting left as it was. */
export function withD1DatabaseId(text: string, index: number, id: string): string {
  const edits = modify(text, ['d1_databases', index, 'database_id'], id, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  return applyEdits(text, edits)
}

function describeAccount(plan: D1CreatePlan): string {
  return plan.configAccountId
    ? `account ${plan.configAccountId}`
    : 'the account CLOUDFLARE_ACCOUNT_ID names'
}

function recoveryHint(plan: D1CreatePlan, id: string): string {
  return (
    `The database ${plan.databaseName} (${id}) now exists in ${describeAccount(plan)}. ` +
    `Set d1_databases[${plan.index}].database_id to ${id} in ${plan.wranglerConfig} by hand. ` +
    'Do not re-run db create: the database is not to be created twice.'
  )
}

export function runD1Create(
  options: D1CreateOptions,
  executor: D1CreateExecutor = runWranglerForD1Create,
): D1CreateResult {
  const plan = planD1Create(options)
  const base = {
    binding: plan.binding,
    databaseName: plan.databaseName,
    accountId: plan.configAccountId,
    accountSource: plan.accountSource,
    wranglerConfig: plan.wranglerConfig,
  }
  if (options.dryRun) return { status: 'dry-run', databaseId: null, ...base }

  const env = { ...(options.env ?? process.env), CLOUDFLARE_ACCOUNT_ID: plan.accountId }
  const output = executor(buildWranglerD1CreateArgs(plan), dirname(plan.wranglerConfigPath), env)
  let id: string
  try {
    id = parseD1CreateOutput(output)
  } catch (error) {
    throw new Error(
      `db create: ${(error as Error).message}. Wrangler exited 0, so database ` +
        `${plan.databaseName} may exist in ${describeAccount(plan)}: read its id with ` +
        '`wrangler d1 info ' +
        plan.databaseName +
        '` and set it by hand. Do not re-run db create.\n--- wrangler output ---\n' +
        output.trim(),
    )
  }

  const current = readFileSync(plan.wranglerConfigPath, 'utf8')
  if (current !== plan.wranglerText) {
    throw new Error(
      `db create: ${plan.wranglerConfig} changed while wrangler ran, so it was not written. ` +
        recoveryHint(plan, id),
    )
  }
  const next = withD1DatabaseId(current, plan.index, id)
  const check = parseJsoncText(next, plan.wranglerConfigPath)
  const written =
    isRecord(check) && Array.isArray(check.d1_databases) ? check.d1_databases[plan.index] : null
  if (!isRecord(written) || written.database_id !== id || written.binding !== plan.binding) {
    throw new Error(
      `db create: the edit to ${plan.wranglerConfig} did not produce the expected binding, so ` +
        `it was not written. ${recoveryHint(plan, id)}`,
    )
  }
  writeFileSync(plan.wranglerConfigPath, next, 'utf8')
  return { status: 'created', databaseId: id, ...base }
}

function formatAccount(result: D1CreateResult): string {
  return result.accountId
    ? `${result.accountId} (from ${result.accountSource})`
    : 'from CLOUDFLARE_ACCOUNT_ID (value not echoed)'
}

export function formatD1CreateResult(result: D1CreateResult): string {
  const lines =
    result.status === 'dry-run'
      ? [
          `[db create] dry run: would create D1 database ${result.databaseName}`,
          `  account   ${formatAccount(result)}`,
          `  binding   ${result.binding}`,
          `  writes    database_id into ${result.wranglerConfig}`,
        ]
      : [
          `[db create] created D1 database ${result.databaseName}`,
          `  id        ${result.databaseId}`,
          `  account   ${formatAccount(result)}`,
          `  binding   ${result.binding}`,
          `  written   database_id in ${result.wranglerConfig}`,
          '  The id is configuration, not a secret: commit the config change.',
        ]
  return lines.join('\n')
}

export interface D1CreateFlags {
  checkoutDir: string
  binding?: string
  dryRun: boolean
  json: boolean
}

export function parseD1CreateArgs(args: string[]): D1CreateFlags {
  let checkoutDir = process.cwd()
  let binding: string | undefined
  let dryRun = false
  let json = false
  const value = (flag: string, next: string | undefined): string => {
    if (!next || next.startsWith('--')) throw new Error(`${flag} requires a value`)
    return next
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--checkout') checkoutDir = value(arg, args[(index += 1)])
    else if (arg === '--binding') binding = value(arg, args[(index += 1)])
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--json') json = true
    else
      throw new Error(
        `Unknown db create option: ${arg}. The database name is read from ` +
          `${CLOUDFLARE_APP_MANIFEST}, never passed as an argument.`,
      )
  }
  return { checkoutDir: resolve(checkoutDir), ...(binding ? { binding } : {}), dryRun, json }
}
