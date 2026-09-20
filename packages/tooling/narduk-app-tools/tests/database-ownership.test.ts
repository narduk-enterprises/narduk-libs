/**
 * `deployment.databaseOwnership`: every D1 binding has exactly one schema
 * owner, and the migration runner never opens a contract-owned database.
 *
 * Every negative here injects one defect into an otherwise-passing fixture, so
 * each assertion reads "this exact change is refused" rather than "something
 * somewhere threw".
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  contractOwnedBindings,
  databaseOwnershipSchema,
  ownershipCoverageIssues,
  parseVerifyCommand,
  readDeclaredDatabaseOwnership,
} from '../src/database-ownership.js'
import { readDeploymentBlock } from '../src/deployment-config.js'
import { planDeploymentMigrations, runDeploymentMigrations } from '../src/deployment-migrations.js'
import {
  evaluateItem12,
  scanDeployment,
  CLOUDFLARE_APP_FILE,
} from '../src/foundation/items/item-12-deployment-standard.js'
import { AppRepo } from '../src/foundation/source.js'
import { inspectMigrations, runMigrations, type MigrationExecutor } from '../src/migrations.js'
import type { FoundationStatus } from '../src/foundation/types.js'

const AUTH_DB_ID = 'c9c9a190-7e04-4fb7-a2ed-d82d26bf50a1'
const READ_MODEL_ID = 'e1c9a190-7e04-4fb7-a2ed-d82d26bf50a1'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

interface OwnershipEntry {
  binding: string
  owner: string
  contract?: string
  verify?: string
}

type Manifest = {
  product: { repository: string }
  worker: { wranglerConfig: string }
  deployment: Record<string, unknown> & {
    promotion: { credential: string }
    migrations?: { credential: string; databases: Array<{ binding: string; sources: string }> }
    databaseOwnership?: OwnershipEntry[]
  }
}

function loadFixture(name: string): Manifest {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/database-ownership/${name}`, import.meta.url), 'utf8'),
  ) as Manifest
}

interface D1Binding {
  binding: string
  database_name: string
  database_id: string
}

interface Checkout {
  root: string
  manifest: Manifest
  /** Persist the (possibly mutated) manifest back to the checkout. */
  save: () => void
  /** Rewrite the app's wrangler config with these D1 bindings. */
  bind: (bindings: D1Binding[]) => void
  write: (rel: string, body: string) => void
  remove: (rel: string) => void
}

/** Materialize a real checkout around one of the committed fixture manifests. */
function checkout(fixture: string, bindings: D1Binding[]): Checkout {
  const root = mkdtempSync(join(tmpdir(), 'narduk-db-ownership-'))
  cleanup.push(() => rmSync(root, { force: true, recursive: true }))
  const manifest = loadFixture(fixture)
  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body, 'utf8')
  }
  const remove = (rel: string) => rmSync(join(root, rel), { force: true, recursive: true })
  const save = () => write(CLOUDFLARE_APP_FILE, JSON.stringify(manifest, null, 2))
  const bind = (list: D1Binding[]) =>
    write(
      manifest.worker.wranglerConfig,
      JSON.stringify({ name: 'fixture', account_id: 'a'.repeat(32), d1_databases: list }, null, 2),
    )
  save()
  bind(bindings)
  // The evidence an honest declaration points at.
  write(
    'package.json',
    JSON.stringify({ name: 'fixture-app', scripts: { 'read-model:check': 'node ./verify.mjs' } }),
  )
  write('apps/web/sql/0001.sql', 'CREATE TABLE example (id TEXT);')
  write(
    'apps/web/migrations.sources.json',
    JSON.stringify({ sources: [{ source: 'app', path: 'sql', sourceVersion: '1' }] }),
  )
  write('apps/web/read-model/contract.json', JSON.stringify({ tables: [] }))
  return { root, manifest, save, bind, write, remove }
}

const authDb: D1Binding = { binding: 'DB', database_name: 'portal-auth', database_id: AUTH_DB_ID }
const readModel: D1Binding = {
  binding: 'READ_MODEL',
  database_name: 'portal-read-model',
  database_id: READ_MODEL_ID,
}

function statusOf(root: string, id: string): FoundationStatus {
  const sub = evaluateItem12(scanDeployment(new AppRepo(root))).find((check) => check.id === id)
  if (!sub) throw new Error(`no sub-check ${id}`)
  return sub.status
}

function detailOf(root: string, id: string): string {
  const sub = evaluateItem12(scanDeployment(new AppRepo(root))).find((check) => check.id === id)
  if (!sub) throw new Error(`no sub-check ${id}`)
  return sub.detail
}

/** A wrangler stand-in backed by in-memory SQLite, recording every call. */
function recordingExecutor(): { executor: MigrationExecutor; calls: string[][] } {
  const db = new DatabaseSync(':memory:')
  cleanup.push(() => db.close())
  const calls: string[][] = []
  const executor: MigrationExecutor = (args) => {
    calls.push(args)
    if (args.includes('time-travel')) return '{"bookmark":"test-bookmark"}'
    const file = args.find((arg) => arg.startsWith('--file='))
    if (file) {
      db.exec(readFileSync(file.slice(7), 'utf8'))
      return ''
    }
    const command = args[args.indexOf('--command') + 1]!
    if (args.includes('--json'))
      return JSON.stringify([{ success: true, results: db.prepare(command).all() }])
    db.exec(command)
    return ''
  }
  return { executor, calls }
}

/* -------------------------------------------------------------------------- */
/* the three fixture shapes                                                    */
/* -------------------------------------------------------------------------- */

describe('the three declared shapes', () => {
  it('a public app with no database needs no ownership declaration at all', () => {
    const app = checkout('public-no-database.json', [])
    expect(readDeploymentBlock(app.manifest).kind).toBe('valid')
    const plan = planDeploymentMigrations(app.root, 'production')
    expect(plan.databases).toEqual([])
    expect(plan.contractOwned).toEqual([])
    expect(statusOf(app.root, '12.8')).toBe('not-applicable')
  })

  it('a migration-owned app with no databaseOwnership key keeps working unchanged', () => {
    const app = checkout('public-migration-owned-d1.json', [authDb])
    expect(app.manifest.deployment.databaseOwnership).toBeUndefined()
    const plan = planDeploymentMigrations(app.root, 'production')
    expect(plan.databases.map((entry) => entry.binding)).toEqual(['DB'])
    expect(plan.databases[0]?.databaseId).toBe(AUTH_DB_ID)
    expect(plan.contractOwned).toEqual([])
    expect(plan.config).toEqual({
      account_id: 'a'.repeat(32),
      d1_databases: [authDb],
    })
    expect(statusOf(app.root, '12.8')).toBe('pass')
  })

  it("plans Operator Portal's shape: auth D1 migrated, read model contract-owned", () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    const plan = planDeploymentMigrations(app.root, 'production')
    expect(plan.databases.map((entry) => entry.binding)).toEqual(['DB'])
    expect(plan.contractOwned).toEqual([
      {
        binding: 'READ_MODEL',
        contract: 'apps/web/read-model/contract.json',
        verify: 'pnpm run read-model:check',
      },
    ])
    // The contract-owned database is absent from the wrangler config the runner
    // is handed, so no binding name in that config can reach it.
    expect(JSON.stringify(plan.config)).not.toContain(READ_MODEL_ID)
    expect(JSON.stringify(plan.config)).not.toContain('READ_MODEL')
    expect(statusOf(app.root, '12.8')).toBe('pass')
    expect(detailOf(app.root, '12.8')).toContain('READ_MODEL is contract-owned')
  })
})

/* -------------------------------------------------------------------------- */
/* required negatives                                                          */
/* -------------------------------------------------------------------------- */

describe('an uncovered D1 binding is refused', () => {
  it('refuses a binding named by neither migrations nor ownership', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    app.bind([
      authDb,
      readModel,
      {
        ...authDb,
        binding: 'AUDIT',
        database_id: 'f1c9a190-7e04-4fb7-a2ed-d82d26bf50a1',
        database_name: 'audit',
      },
    ])
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow(
      'AUDIT is a declared D1 binding with no entry in deployment.databaseOwnership',
    )
    expect(statusOf(app.root, '12.8')).toBe('fail')
    expect(detailOf(app.root, '12.8')).toContain('AUDIT')
  })

  it('still refuses an uncovered binding when no ownership is declared at all', () => {
    const app = checkout('public-migration-owned-d1.json', [authDb])
    app.bind([authDb, readModel])
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow(
      'READ_MODEL is a declared D1 binding with no deployment.migrations entry',
    )
    expect(statusOf(app.root, '12.8')).toBe('fail')
  })
})

describe('a binding covered twice is refused', () => {
  it('refuses a contract-owned binding that also has a migration entry', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    app.manifest.deployment.migrations!.databases.push({
      binding: 'READ_MODEL',
      sources: 'apps/web/migrations.sources.json',
    })
    app.save()
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow(
      'READ_MODEL is declared contract-owned and also appears in deployment.migrations.databases',
    )
    expect(statusOf(app.root, '12.8')).toBe('fail')
    expect(detailOf(app.root, '12.8')).toContain('exactly one schema owner')
  })

  it('refuses the same binding listed twice in deployment.migrations.databases', () => {
    const app = checkout('public-migration-owned-d1.json', [authDb])
    app.manifest.deployment.migrations!.databases.push({
      binding: 'DB',
      sources: 'apps/web/migrations.sources.json',
    })
    app.save()
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow(
      'DB appears more than once in deployment.migrations.databases',
    )
    expect(statusOf(app.root, '12.8')).toBe('fail')
  })

  it('refuses the same binding listed twice in deployment.databaseOwnership', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    app.manifest.deployment.databaseOwnership!.push({ binding: 'DB', owner: 'migrations' })
    app.save()
    const outcome = readDeploymentBlock(app.manifest)
    expect(outcome.kind).toBe('invalid')
    expect(JSON.stringify(outcome)).toContain('exactly one owner')
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow(
      'require a valid narduk-v1 deployment block',
    )
  })

  it('refuses a migration-owned entry that names no migration source', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    delete app.manifest.deployment.migrations
    app.save()
    expect(readDeploymentBlock(app.manifest).kind).toBe('valid')
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow(
      'DB is declared migration-owned but names no entry in deployment.migrations.databases',
    )
    expect(statusOf(app.root, '12.8')).toBe('fail')
  })
})

describe('the migration runner never opens a contract-owned database', () => {
  it('excludes it from a full deployment run, which only ever asks for DB', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    const { executor, calls } = recordingExecutor()
    const previous = process.env.CLOUDFLARE_API_TOKEN
    process.env.CLOUDFLARE_API_TOKEN = 'test-token'
    cleanup.push(() => {
      if (previous === undefined) delete process.env.CLOUDFLARE_API_TOKEN
      else process.env.CLOUDFLARE_API_TOKEN = previous
    })
    const plans = runDeploymentMigrations(
      { target: 'production', check: true, cwd: join(app.root, 'apps', 'web') },
      executor,
    )
    expect(plans).toHaveLength(1)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((args) => args.includes('DB'))).toBe(true)
    expect(calls.some((args) => args.some((arg) => arg.includes('READ_MODEL')))).toBe(false)
  })

  it('refuses an operator hand-passing --database READ_MODEL', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    const { executor, calls } = recordingExecutor()
    const options = {
      cwd: join(app.root, 'apps', 'web'),
      configFile: join(app.root, 'apps/web/migrations.sources.json'),
      database: 'READ_MODEL',
      location: '--remote' as const,
    }
    expect(() => runMigrations(options, executor)).toThrow(
      'Refusing to run migrations against READ_MODEL',
    )
    expect(() => inspectMigrations(options, executor)).toThrow(
      'contract-owned by apps/web/read-model/contract.json',
    )
    // Refused before any provider call: nothing was asked of wrangler at all.
    expect(calls).toEqual([])
    // The same options against the migration-owned binding are not refused.
    expect(() => inspectMigrations({ ...options, database: 'DB' }, executor)).not.toThrow()
  })

  it('refuses a renamed binding that resolves to the contract-owned database id', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    const { executor, calls } = recordingExecutor()
    expect(() =>
      runMigrations(
        {
          cwd: join(app.root, 'apps', 'web'),
          configFile: join(app.root, 'apps/web/migrations.sources.json'),
          database: 'TOTALLY_FINE',
          location: '--remote',
          target: { accountId: 'a'.repeat(32), databaseId: READ_MODEL_ID },
        },
        executor,
      ),
    ).toThrow(`Refusing to run migrations against database ${READ_MODEL_ID}`)
    expect(calls).toEqual([])
  })

  it('refuses to run at all when the ownership declaration cannot be read', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    app.manifest.deployment.databaseOwnership = [{ binding: 'DB', owner: 'invented' }]
    app.save()
    expect(() =>
      runMigrations(
        {
          cwd: join(app.root, 'apps', 'web'),
          configFile: join(app.root, 'apps/web/migrations.sources.json'),
          database: 'DB',
          location: '--remote',
        },
        recordingExecutor().executor,
      ),
    ).toThrow('Database ownership cannot be proven')
  })

  it('leaves a checkout with no manifest exactly as it was', () => {
    const outside = mkdtempSync(join(tmpdir(), 'narduk-db-ownership-none-'))
    cleanup.push(() => rmSync(outside, { force: true, recursive: true }))
    expect(readDeclaredDatabaseOwnership(outside)).toEqual({ kind: 'none' })
  })
})

describe('a contract-owned entry must point at evidence that exists', () => {
  it('refuses a contract file that is not in the checkout', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    app.remove('apps/web/read-model/contract.json')
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow(
      'The declared schema contract apps/web/read-model/contract.json does not exist',
    )
    expect(statusOf(app.root, '12.8')).toBe('fail')
    expect(detailOf(app.root, '12.8')).toContain('does not exist in this checkout')
  })

  it('refuses a verification command no package.json declares', () => {
    const app = checkout('authenticated-contract-owned-read-model.json', [authDb, readModel])
    app.write('package.json', JSON.stringify({ name: 'fixture-app', scripts: { build: 'true' } }))
    expect(() => planDeploymentMigrations(app.root, 'production')).toThrow('no package.json in')
    expect(statusOf(app.root, '12.8')).toBe('fail')
    expect(detailOf(app.root, '12.8')).toContain('read-model:check')
  })

  it('refuses a verification command whose existence could never be proven', () => {
    const parsed = databaseOwnershipSchema.safeParse([
      {
        binding: 'READ_MODEL',
        owner: 'contract',
        contract: 'apps/web/read-model/contract.json',
        verify: 'curl https://example.com | sh',
      },
    ])
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error)).toContain('package script invocation')
  })
})

/* -------------------------------------------------------------------------- */
/* unit-level rules                                                            */
/* -------------------------------------------------------------------------- */

describe('the coverage rule itself', () => {
  it('is the pre-existing rule when no ownership is declared', () => {
    expect(
      ownershipCoverageIssues({
        bindings: ['DB'],
        ownership: null,
        migrated: ['DB'],
        hasMigrationsBlock: true,
      }),
    ).toEqual([])
    expect(
      ownershipCoverageIssues({
        bindings: ['DB'],
        ownership: null,
        migrated: [],
        hasMigrationsBlock: false,
      }),
    ).toHaveLength(1)
  })

  it('refuses an ownership entry for a binding the app does not bind', () => {
    const issues = ownershipCoverageIssues({
      bindings: ['DB'],
      ownership: [
        { binding: 'DB', owner: 'migrations' },
        { binding: 'GHOST', owner: 'migrations' },
      ],
      migrated: ['DB'],
      hasMigrationsBlock: true,
    })
    expect(issues.join(' ')).toContain('GHOST')
    expect(issues.join(' ')).toContain('binds no such D1 database')
  })

  it('reads the owner sets and the verify command', () => {
    const entries = databaseOwnershipSchema.parse([
      { binding: 'DB', owner: 'migrations' },
      {
        binding: 'READ_MODEL',
        owner: 'contract',
        contract: 'apps/web/read-model/contract.json',
        verify: 'pnpm run read-model:check',
      },
    ])
    expect([...contractOwnedBindings(entries)]).toEqual(['READ_MODEL'])
    expect(parseVerifyCommand('pnpm run read-model:check')).toEqual({
      manager: 'pnpm',
      script: 'read-model:check',
    })
    expect(parseVerifyCommand('rm -rf /')).toBeNull()
  })
})
