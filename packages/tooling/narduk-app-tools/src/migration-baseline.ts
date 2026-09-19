import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const text = z.string().min(1).max(1_000_000)
const checksum = z.string().regex(/^[a-f0-9]{64}$/u)
const objectSchema = z
  .object({
    type: z.enum(['table', 'index', 'view', 'trigger']),
    name: text,
    table: text,
    sql: text,
  })
  .strict()
const ledgerRowSchema = z
  .object({
    source: text,
    filename: text,
    checksum,
    sourceVersion: text,
  })
  .strict()
const payloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('narduk-d1-cutover'),
    capturedAt: z.iso.datetime(),
    revision: z.string().regex(/^[a-f0-9]{40}$/u),
    origin: z.object({ accountId: text, databaseId: text }).strict(),
    objects: z.array(objectSchema).max(10_000),
    migrations: z.array(ledgerRowSchema).max(10_000),
    legacy: z
      .array(z.object({ filename: text, source: z.enum(['wrangler']).nullable() }).strict())
      .max(10_000),
  })
  .strict()
const artifactSchema = payloadSchema.extend({ digest: checksum })

export type MigrationBaselineObject = z.infer<typeof objectSchema>
export type MigrationBaselinePayload = z.infer<typeof payloadSchema>
export type MigrationBaseline = z.infer<typeof artifactSchema>

export const BASELINE_RECEIPTS_TABLE = '_narduk_migration_baselines'
export function isMigrationMetadata(name: string): boolean {
  return (
    name.startsWith('sqlite_') ||
    name.startsWith('_cf_') ||
    [
      '_narduk_migrations',
      '_narduk_migration_lock',
      BASELINE_RECEIPTS_TABLE,
      '_applied_migrations',
      'd1_migrations',
    ].includes(name)
  )
}

function normalizeSchemaSql(value: string): string {
  const sql = value.trim()
  let end = sql.length
  while (end > 0 && sql[end - 1] === ';') end--
  return sql.slice(0, end)
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Exact schema text is deliberate: names/counts alone cannot establish equivalence. */
export function normalizeBaselineObjects(
  rows: MigrationBaselineObject[],
): MigrationBaselineObject[] {
  const objects = rows
    .filter((row) => !isMigrationMetadata(row.name) && !isMigrationMetadata(row.table))
    .map((row) => ({ ...row, sql: normalizeSchemaSql(row.sql) }))
    .sort((a, b) => `${a.type}\0${a.name}`.localeCompare(`${b.type}\0${b.name}`, 'en'))
  for (const object of objects) {
    if (!/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\b/iu.test(object.sql)) {
      throw new Error(
        `Unsupported baseline DDL for ${object.name}; virtual tables require a separate reviewed process`,
      )
    }
  }
  return objects
}

export function createMigrationBaseline(input: MigrationBaselinePayload): MigrationBaseline {
  const payload = payloadSchema.parse(input)
  payload.objects = normalizeBaselineObjects(payload.objects)
  payload.migrations.sort((a, b) =>
    `${a.source}\0${a.filename}`.localeCompare(`${b.source}\0${b.filename}`, 'en'),
  )
  payload.legacy.sort((a, b) =>
    `${a.source}\0${a.filename}`.localeCompare(`${b.source}\0${b.filename}`, 'en'),
  )
  for (const identities of [
    payload.objects.map((row) => row.name),
    payload.migrations.map((row) => `${row.source}\0${row.filename}`),
    payload.legacy.map((row) => `${row.source}\0${row.filename}`),
  ]) {
    if (new Set(identities).size !== identities.length)
      throw new Error('Duplicate cutover artifact identity')
  }
  return { ...payload, digest: hash(JSON.stringify(payload)) }
}

export function parseMigrationBaseline(value: unknown): MigrationBaseline {
  const parsed = artifactSchema.parse(value)
  const { digest, ...payload } = parsed
  const expected = createMigrationBaseline(payload)
  if (expected.digest !== digest) throw new Error('Cutover artifact digest mismatch')
  return expected
}

export function readMigrationBaseline(path: string): MigrationBaseline {
  const bytes = readFileSync(path)
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Cutover artifact exceeds 8 MiB')
  return parseMigrationBaseline(JSON.parse(bytes.toString('utf8')))
}

/** An immutable schema-only initial migration; never claims historical DML ran. */
export function migrationBaselineSql(artifact: MigrationBaseline): string {
  const checked = parseMigrationBaseline(artifact)
  const order = { table: 0, index: 1, view: 2, trigger: 3 }
  const objects = [...checked.objects].sort((a, b) => order[a.type] - order[b.type])
  if (!objects.some((entry) => entry.type === 'table'))
    throw new Error('Cannot baseline an empty application schema')
  return `-- Frozen schema baseline. Cutover: ${checked.digest}\n-- Contains no application rows or claim that historical data migrations ran.\n${objects.map((entry) => `${entry.sql};`).join('\n')}\n`
}

export function assertBaselineState(expected: MigrationBaseline, actual: MigrationBaseline): void {
  for (const key of ['objects', 'migrations', 'legacy'] as const) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      throw new Error(`Database ${key} differ from the reviewed cutover artifact`)
    }
  }
}
