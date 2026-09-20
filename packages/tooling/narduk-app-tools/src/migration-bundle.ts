import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'

import {
  checksumMigrationSql,
  discoverMigrations,
  migrationSqlTouchesRunnerLedger,
  loadMigrationConfig,
  parseMigrationConfig,
  resolveMigrationConfigVersions,
} from './migrations.js'

/** Plain SQL/data only. Never install or execute a preview checkout with D1 credentials. */
const migrationBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repository: z.string().min(1),
  sha: z.string().regex(/^[a-f0-9]{40}$/u),
  databases: z
    .array(
      z.strictObject({
        binding: z.string().regex(/^[A-Za-z_]\w*$/u),
        adoptions: z.array(z.unknown()).max(10000),
        sources: z
          .array(
            z.strictObject({
              source: z.string().min(1).max(300),
              sourceVersion: z.string().min(1).max(200),
            }),
          )
          .min(1)
          .max(10000),
        migrations: z
          .array(
            z.strictObject({
              source: z.string().min(1).max(300),
              sourceVersion: z.string().min(1).max(200),
              filename: z.string().regex(/^\d{4,}(?:_\w[\w.-]*)?\.sql$/iu),
              checksum: z.string().regex(/^[a-f0-9]{64}$/u),
              sql: z.string().max(1_000_000),
            }),
          )
          .max(10000),
      }),
    )
    .max(100),
})
export type MigrationBundle = z.infer<typeof migrationBundleSchema>

export function createMigrationBundle(
  repository: string,
  sha: string,
  databases: Array<{ binding: string; sources: string }>,
): MigrationBundle {
  return migrationBundleSchema.parse({
    schemaVersion: 1,
    repository,
    sha,
    databases: databases.map(({ binding, sources }) => {
      const loaded = loadMigrationConfig(sources)
      const config = resolveMigrationConfigVersions(loaded.config, loaded.baseDir)
      return {
        binding,
        adoptions: config.adoptions,
        sources: config.sources.map(({ source, sourceVersion }) => ({ source, sourceVersion })),
        migrations: discoverMigrations(config, loaded.baseDir).map(({ path, ...migration }) => ({
          ...migration,
          sql: readFileSync(path, 'utf8'),
        })),
      }
    }),
  })
}

export function readMigrationBundle(
  path: string,
  repository: string,
  sha: string,
): MigrationBundle {
  if (statSync(path).size > 50_000_000) throw new Error('Migration bundle exceeds 50 MB')
  const bundle = migrationBundleSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (bundle.repository !== repository || bundle.sha !== sha)
    throw new Error('Migration bundle repository/SHA differs from the verified CI run')
  if (new Set(bundle.databases.map((db) => db.binding)).size !== bundle.databases.length)
    throw new Error('Duplicate database binding in migration bundle')
  for (const db of bundle.databases) {
    if (new Set(db.sources.map((source) => source.source)).size !== db.sources.length)
      throw new Error('Duplicate migration source in bundle')
    for (const migration of db.migrations) {
      if (
        !db.sources.some(
          (source) =>
            source.source === migration.source && source.sourceVersion === migration.sourceVersion,
        )
      )
        throw new Error('Migration is outside the declared bundle sources')
      if (checksumMigrationSql(migration.sql) !== migration.checksum)
        throw new Error('Migration bundle SQL checksum differs')
      // D1 SQL cannot select another database. Reserve the coordination tables
      // nevertheless: SQL data must not disable the runner's lock or ledger.
      if (migrationSqlTouchesRunnerLedger(migration.sql))
        throw new Error('Migration SQL may not alter the runner ledger or lock')
    }
  }
  return bundle
}

/** All paths are generated here, never taken from an artifact. */
export function materializeMigrationBundle(
  bundle: MigrationBundle,
  directory: string,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [databaseIndex, database] of bundle.databases.entries()) {
    const base = join(directory, `database-${databaseIndex}`)
    mkdirSync(base, { recursive: true })
    const sources = new Map<string, { source: string; sourceVersion: string; path: string }>()
    for (const [sourceIndex, entry] of database.sources.entries()) {
      const path = `source-${sourceIndex}`
      sources.set(entry.source, { ...entry, path })
      mkdirSync(join(base, path))
    }
    for (const migration of database.migrations) {
      const source = sources.get(migration.source)
      if (!source || source.sourceVersion !== migration.sourceVersion)
        throw new Error('Migration is outside the declared bundle sources')
      writeFileSync(join(base, source.path, migration.filename), migration.sql, { flag: 'wx' })
    }
    const config = parseMigrationConfig({
      schemaVersion: 1,
      sources: [...sources.values()],
      adoptions: database.adoptions,
    })
    const path = join(base, 'migrations.sources.json')
    writeFileSync(path, JSON.stringify(config))
    result.set(database.binding, relative(directory, path))
  }
  return result
}
