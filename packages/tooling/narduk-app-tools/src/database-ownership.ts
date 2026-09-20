/**
 * `deployment.databaseOwnership` -- who owns the schema of each D1 binding.
 *
 * Before this existed, `deployment.migrations` was the only answer an app could
 * give about a D1 database, and the coverage rule demanded it cover **every**
 * binding exactly once. That is right for a database whose schema is a numbered,
 * forward-only migration history. It is wrong for a database whose schema is
 * owned by something else -- a JSON contract plus a refresh job that applies it,
 * for instance -- because the only way to satisfy the rule is to manufacture a
 * migration baseline for a database nobody migrates. A fabricated baseline is
 * worse than no declaration: it is a false claim that the migration ledger
 * describes that database's schema, and the next agent reads it as truth.
 *
 * So ownership becomes explicit and total. Each binding is declared exactly
 * once, as one of:
 *
 * - **`owner: "migrations"`** -- the schema is the migration history. The entry
 *   resolves to an entry in `deployment.migrations.databases`, which keeps the
 *   sources manifest in one place rather than duplicating it here.
 * - **`owner: "contract"`** -- the schema is a contract file in the repository,
 *   and a named verification command proves the live database matches it. The
 *   migration runner must never touch this database.
 *
 * **The load-bearing invariant is at the runner, not at the schema.** A
 * validator that only refuses bad config is defeated by an operator typing
 * `narduk-app db migrate --database READ_MODEL`. Every path that opens a D1
 * database for migration work -- run, status, baseline capture, baseline
 * registration -- goes through `migrationDatabase()` in `./migrations.ts`, and
 * that function calls `assertMigrationRunnerOwnership` here. There is one choke
 * point on purpose.
 *
 * **Compatibility.** `databaseOwnership` is optional and absent means exactly
 * what it meant before: `deployment.migrations` must cover every binding. An
 * app that migrates everything changes nothing.
 *
 * **Why the verification command must be a package script.** "The command that
 * proves the schema" is only worth declaring if its absence is detectable. A
 * free-form shell string cannot be checked by a repository read, so a typo
 * would sit in the manifest looking like proof. A `pnpm run <script>` form
 * resolves against the app's own `package.json`, so a command that does not
 * exist is a refusal rather than a promise.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { parse as parseJsonc } from 'jsonc-parser'
import { z } from 'zod'

/** The manifest that marks the root of an app checkout. */
export const CLOUDFLARE_APP_MANIFEST = 'Config/cloudflare-app.json'

const bindingName = z.string().trim().min(1).max(200)

/** A checkout-relative path. Absolute paths and `..` segments are refused here
 * rather than at use, so a bad value never reaches a filesystem read. */
const repoPath = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !value.startsWith('/'),
    'Expected a checkout-relative path without ".." segments',
  )

/** `pnpm run read-model:check` and friends. The capture is the script name. */
export const VERIFY_COMMAND_PATTERN = /^(pnpm|npm|yarn|bun)\s+run\s+([\w:@./-]+)$/u

const verifyCommand = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => VERIFY_COMMAND_PATTERN.test(value),
    'Expected a package script invocation such as "pnpm run read-model:check", so its existence can be proven',
  )

const migrationOwnedEntry = z.strictObject({
  binding: bindingName,
  owner: z.literal('migrations'),
})

const contractOwnedEntry = z.strictObject({
  binding: bindingName,
  owner: z.literal('contract'),
  /** The schema contract this database's shape is defined by. */
  contract: repoPath,
  /** The command that proves the live database matches that contract. */
  verify: verifyCommand,
})

export const databaseOwnershipEntrySchema = z.discriminatedUnion('owner', [
  migrationOwnedEntry,
  contractOwnedEntry,
])

export type DatabaseOwnershipEntry = z.infer<typeof databaseOwnershipEntrySchema>
export type ContractOwnedEntry = Extract<DatabaseOwnershipEntry, { owner: 'contract' }>

/** One entry per binding: a second entry for the same binding is a
 * contradiction about who owns that schema, not a refinement of the first. */
export const databaseOwnershipSchema = z
  .array(databaseOwnershipEntrySchema)
  .min(1)
  .max(100)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>()
    for (const [index, entry] of entries.entries()) {
      const binding = entry.binding.trim()
      if (seen.has(binding)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'binding'],
          message: `${binding} is declared more than once; every D1 binding gets exactly one owner`,
        })
      }
      seen.add(binding)
    }
  })

export type DatabaseOwnershipList = z.infer<typeof databaseOwnershipSchema>

export function contractOwnedEntries(
  entries: readonly DatabaseOwnershipEntry[],
): ContractOwnedEntry[] {
  return entries.filter((entry): entry is ContractOwnedEntry => entry.owner === 'contract')
}

export function contractOwnedBindings(entries: readonly DatabaseOwnershipEntry[]): Set<string> {
  return new Set(contractOwnedEntries(entries).map((entry) => entry.binding.trim()))
}

/** The script a verification command names, or null if it is not one. */
export function parseVerifyCommand(command: string): { manager: string; script: string } | null {
  const match = VERIFY_COMMAND_PATTERN.exec(command.trim())
  return match ? { manager: match[1]!, script: match[2]! } : null
}

/** The script names a `package.json` text declares, or an empty set. */
function declaredScripts(packageJsonText: string | null): Set<string> {
  if (packageJsonText === null) return new Set()
  let pkg: unknown
  try {
    pkg = JSON.parse(packageJsonText)
  } catch {
    return new Set()
  }
  if (pkg === null || typeof pkg !== 'object') return new Set()
  const scripts = (pkg as { scripts?: unknown }).scripts
  if (scripts === null || typeof scripts !== 'object') return new Set()
  return new Set(
    Object.entries(scripts as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string')
      .map(([name]) => name),
  )
}

export interface OwnershipEvidenceInput {
  entries: readonly DatabaseOwnershipEntry[]
  /** Read a checkout-relative text file, or null when it does not exist. */
  read: (rel: string) => string | null
  /** Checkout-relative `package.json` paths whose scripts may satisfy a
   * `verify` command -- the app's own, and the workspace root in a monorepo. */
  packageJsonRels: readonly string[]
}

/**
 * Every way a contract-owned declaration fails to be evidence, as readable
 * lines. One implementation, two callers: `planDeploymentMigrations` throws on
 * the first of them, and foundation item 12.8 reports them all.
 *
 * A declaration that names a contract file or a verification command that does
 * not exist is the failure mode this exists to catch: it reads in review as if
 * the schema were proven, and nothing would ever have run.
 */
export function contractEvidenceIssues(input: OwnershipEvidenceInput): string[] {
  const issues: string[] = []
  const scripts = new Set<string>()
  for (const rel of input.packageJsonRels) {
    for (const name of declaredScripts(input.read(rel))) scripts.add(name)
  }
  for (const entry of contractOwnedEntries(input.entries)) {
    const binding = entry.binding.trim()
    if (input.read(entry.contract) === null) {
      issues.push(
        `${binding} names the schema contract ${entry.contract}, which does not exist in this checkout`,
      )
    }
    const parsed = parseVerifyCommand(entry.verify)
    if (!parsed) {
      issues.push(
        `${binding} names the verification command "${entry.verify}", which is not a package ` +
          `script invocation, so its existence cannot be proven`,
      )
      continue
    }
    if (!scripts.has(parsed.script)) {
      issues.push(
        `${binding} names the verification command "${entry.verify}", but no package.json in ` +
          `${input.packageJsonRels.join(' or ')} declares a "${parsed.script}" script`,
      )
    }
  }
  return issues
}

/** `contractEvidenceIssues` against a real checkout on disk. */
export function contractEvidenceIssuesOnDisk(
  root: string,
  packageJsonRels: readonly string[],
  entries: readonly DatabaseOwnershipEntry[],
): string[] {
  const read = (rel: string): string | null => {
    if (isAbsolute(rel) || rel.split('/').includes('..')) return null
    const path = join(root, rel)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }
  return contractEvidenceIssues({ entries, read, packageJsonRels })
}

/** Walk up from `cwd` to the checkout that owns `Config/cloudflare-app.json`,
 * or null when there is none -- a plain `db migrate` outside a narduk app. */
export function findAppManifestRoot(cwd: string): string | null {
  let root = resolve(cwd)
  for (;;) {
    if (existsSync(join(root, CLOUDFLARE_APP_MANIFEST))) return root
    const parent = dirname(root)
    if (parent === root) return null
    root = parent
  }
}

export type DeclaredOwnership =
  /** No manifest, or a manifest that declares no ownership: the pre-existing
   * contract, where `deployment.migrations` covers every binding. */
  | { kind: 'none' }
  | { kind: 'declared'; root: string; entries: DatabaseOwnershipList }
  /** A manifest exists but ownership cannot be read from it. Refused rather
   * than assumed absent: an unreadable declaration is not a missing one. */
  | { kind: 'unreadable'; root: string; detail: string }

/**
 * Read `deployment.databaseOwnership` out of the checkout that contains `cwd`.
 *
 * Deliberately independent of the rest of the deployment block's validity. The
 * runner guard must answer "is this binding contract-owned?" even for an app
 * whose block fails some unrelated rule, and it must not be silently disabled
 * by a typo elsewhere in the manifest.
 */
export function readDeclaredDatabaseOwnership(cwd: string): DeclaredOwnership {
  const root = findAppManifestRoot(cwd)
  if (root === null) return { kind: 'none' }
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(root, CLOUDFLARE_APP_MANIFEST), 'utf8'))
  } catch (error) {
    return {
      kind: 'unreadable',
      root,
      detail: `${CLOUDFLARE_APP_MANIFEST} could not be parsed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { kind: 'none' }
  }
  const deployment = (manifest as Record<string, unknown>).deployment
  if (deployment === null || typeof deployment !== 'object' || Array.isArray(deployment)) {
    return { kind: 'none' }
  }
  const raw = (deployment as Record<string, unknown>).databaseOwnership
  if (raw === undefined) return { kind: 'none' }
  const parsed = databaseOwnershipSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      kind: 'unreadable',
      root,
      detail: `deployment.databaseOwnership is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    }
  }
  return { kind: 'declared', root, entries: parsed.data }
}

/** The production database ids of contract-owned bindings, read from the app's
 * own wrangler config. Best effort: a config that cannot be read contributes
 * nothing, because the binding-name check is the primary guard. */
function contractOwnedDatabaseIds(root: string, bindings: Set<string>): Set<string> {
  const ids = new Set<string>()
  if (bindings.size === 0) return ids
  let wranglerConfig: string | undefined
  try {
    const manifest = JSON.parse(readFileSync(join(root, CLOUDFLARE_APP_MANIFEST), 'utf8')) as {
      worker?: { wranglerConfig?: unknown }
    }
    const declared = manifest.worker?.wranglerConfig
    if (typeof declared !== 'string' || declared.trim() === '' || isAbsolute(declared)) return ids
    wranglerConfig = join(root, declared)
  } catch {
    return ids
  }
  if (!existsSync(wranglerConfig)) return ids
  try {
    // `jsonc-parser` directly, not `./deploy.js`'s `readJsonc`: importing that
    // module here would close the cycle database-ownership -> deploy ->
    // deployment-config -> database-ownership, and the schema would be
    // `undefined` at load time.
    const config = parseJsonc(readFileSync(wranglerConfig, 'utf8'), [], {
      allowEmptyContent: false,
      allowTrailingComma: true,
      disallowComments: false,
    }) as { d1_databases?: unknown } | undefined
    const list = Array.isArray(config?.d1_databases) ? config.d1_databases : []
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') continue
      const { binding, database_id: databaseId } = entry as Record<string, unknown>
      if (typeof binding !== 'string' || typeof databaseId !== 'string') continue
      if (bindings.has(binding.trim())) ids.add(databaseId.trim())
    }
  } catch {
    return ids
  }
  return ids
}

export interface OwnershipCoverageInput {
  /** Every D1 binding the checkout's wrangler config(s) declare. */
  bindings: readonly string[]
  /** `deployment.databaseOwnership`, or null when the app declares none. */
  ownership: readonly DatabaseOwnershipEntry[] | null
  /** `deployment.migrations.databases` bindings, in declaration order --
   * duplicates matter, so this is a list rather than a set. */
  migrated: readonly string[]
  /** Whether `deployment.migrations` is present at all. */
  hasMigrationsBlock: boolean
}

/**
 * THE coverage rule: every declared D1 binding has exactly one schema owner.
 *
 * One implementation, three callers -- `planDeploymentMigrations` (which throws
 * on the first issue before any migration runs), foundation sub-check 12.8
 * (which reports them), and `doctor --adoption` requirement 6 (which reads
 * 12.8). A rule copied into three places is a rule that will disagree with
 * itself; the previous version of this check lived in two and already did.
 *
 * With no `databaseOwnership`, this is exactly the pre-existing rule:
 * `deployment.migrations` covers every binding exactly once. That is what keeps
 * an app that migrates everything working with no config change.
 */
export function ownershipCoverageIssues(input: OwnershipCoverageInput): string[] {
  const issues: string[] = []
  const bindings = input.bindings.map((binding) => binding.trim())
  const migrated = input.migrated.map((binding) => binding.trim())
  const seenMigrated = new Set<string>()
  for (const binding of migrated) {
    if (seenMigrated.has(binding)) {
      issues.push(
        `${binding} appears more than once in deployment.migrations.databases; one binding, one migration owner`,
      )
    }
    seenMigrated.add(binding)
  }
  const contract = new Set<string>()
  if (input.ownership) {
    const seen = new Set<string>()
    for (const entry of input.ownership) {
      const binding = entry.binding.trim()
      if (seen.has(binding)) {
        issues.push(
          `${binding} is declared more than once in deployment.databaseOwnership; every D1 binding gets exactly one owner`,
        )
      }
      seen.add(binding)
      if (!bindings.includes(binding)) {
        issues.push(
          `${binding} is declared in deployment.databaseOwnership but this app binds no such D1 database`,
        )
      }
      if (entry.owner === 'contract') {
        contract.add(binding)
        if (seenMigrated.has(binding)) {
          issues.push(
            `${binding} is declared contract-owned and also appears in deployment.migrations.databases; a database has exactly one schema owner`,
          )
        }
      } else if (!seenMigrated.has(binding)) {
        issues.push(
          `${binding} is declared migration-owned but names no entry in deployment.migrations.databases, so nothing says where its migrations come from`,
        )
      }
    }
    for (const binding of bindings) {
      if (!seen.has(binding)) {
        issues.push(
          `${binding} is a declared D1 binding with no entry in deployment.databaseOwnership; when ownership is declared it must name every binding`,
        )
      }
    }
  }
  const expected = bindings.filter((binding) => !contract.has(binding))
  if (expected.length > 0 && !input.hasMigrationsBlock) {
    issues.push(
      `${expected.join(', ')} require deployment.migrations with expand-contract compatibility ` +
        `and one source manifest per binding, or a deployment.databaseOwnership entry declaring ` +
        `the schema contract-owned`,
    )
    return issues
  }
  for (const binding of expected) {
    if (!seenMigrated.has(binding)) {
      issues.push(`${binding} is a declared D1 binding with no deployment.migrations entry`)
    }
  }
  for (const binding of seenMigrated) {
    // A binding that is both migrated and contract-owned was already reported
    // above as a double ownership; it gets no second line here.
    if (!bindings.includes(binding)) {
      issues.push(
        `${binding} has a deployment.migrations entry but this app binds no such D1 database`,
      )
    }
  }
  return issues
}

export interface MigrationOwnershipCheck {
  /** The binding the migration runner was asked to open. */
  database: string
  /** The directory the runner runs in; the checkout is found by walking up. */
  cwd: string
  /** The resolved D1 database id, when the caller knows it. Closes the alias
   * hole where a hand-written wrangler config points some other binding name
   * at the contract-owned database. */
  databaseId?: string | undefined
}

/**
 * The invariant: the migration runner never opens a contract-owned database.
 *
 * Called from `migrationDatabase()`, the single function every migration path
 * uses to reach D1, so `db migrate`, `db status`, `db migrate-deployment`,
 * baseline capture and baseline registration are all covered by one check.
 */
export function assertMigrationRunnerOwnership(options: MigrationOwnershipCheck): void {
  const declared = readDeclaredDatabaseOwnership(options.cwd)
  if (declared.kind === 'none') return
  if (declared.kind === 'unreadable') {
    throw new Error(
      `Refusing to run migrations: ${declared.detail}. Database ownership cannot be proven, ` +
        `and a migration runner must never guess whether a database is contract-owned.`,
    )
  }
  const contract = contractOwnedEntries(declared.entries)
  const byBinding = new Map(contract.map((entry) => [entry.binding.trim(), entry]))
  const requested = options.database.trim()
  const match = byBinding.get(requested)
  if (match) {
    throw new Error(
      `Refusing to run migrations against ${requested}: deployment.databaseOwnership declares ` +
        `it contract-owned by ${match.contract}. Prove it with \`${match.verify}\` instead; ` +
        `the migration runner must never write to a contract-owned database.`,
    )
  }
  const databaseId = options.databaseId?.trim()
  if (!databaseId) return
  const ids = contractOwnedDatabaseIds(
    declared.root,
    new Set(contract.map((entry) => entry.binding.trim())),
  )
  if (ids.has(databaseId)) {
    throw new Error(
      `Refusing to run migrations against database ${databaseId}: it is the database of a ` +
        `contract-owned binding (${contract
          .map((entry) => entry.binding.trim())
          .join(', ')}), whatever binding name selects it.`,
    )
  }
}
