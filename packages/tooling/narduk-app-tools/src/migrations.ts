import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { spawnWranglerSync } from './package-manager.js'
import {
  BASELINE_RECEIPTS_TABLE,
  assertBaselineState,
  createMigrationBaseline,
  isMigrationMetadata,
  migrationBaselineSql,
  parseMigrationBaseline,
  type MigrationBaseline,
  type MigrationBaselineObject,
} from './migration-baseline.js'

export const MIGRATION_LEDGER_TABLE = '_narduk_migrations'
export const MIGRATION_LOCK_TABLE = '_narduk_migration_lock'
export const MIGRATION_CONFIG_VERSION = 1
export const DEFAULT_SOURCE_VERSION = 'unversioned'

export type MigrationLocation = '--local' | '--remote'
export type MigrationActionKind = 'apply' | 'skip' | 'adopt'

export interface MigrationSourceConfig {
  path: string
  source: string
  sourceVersion: string
}

export interface MigrationAdoptionEvidence {
  columns?: ReadonlyArray<{ column: string; table: string }>
  indexes?: ReadonlyArray<{ name: string; table: string }>
  tables: readonly string[]
}

export interface MigrationAdoptionConfig {
  evidence: MigrationAdoptionEvidence
  filename: string
  legacy?: { filename: string; source?: string }
  legacyFilename?: string
  legacySource?: string
  checksum: string
  source: string
  sourceVersion: string
}

export interface MigrationConfig {
  adoptions: readonly MigrationAdoptionConfig[]
  sources: readonly MigrationSourceConfig[]
  schemaVersion: 1
}

export interface MigrationFile {
  checksum: string
  filename: string
  path: string
  source: string
  sourceVersion: string
}

export interface MigrationLedgerRow {
  appliedAt?: string | null
  checksum?: string | null
  filename: string
  source?: string | null
  sourceVersion?: string | null
}

export interface MigrationSchemaEvidence {
  columns: ReadonlyArray<{ column: string; table: string }>
  indexes: ReadonlyArray<{ name: string; table: string }>
  tables: readonly string[]
}

export interface MigrationPlanningInput {
  adoptions?: readonly MigrationAdoptionConfig[]
  ledgerRows?: readonly MigrationLedgerRow[]
  migrations: readonly MigrationFile[]
  schemaEvidence?: MigrationSchemaEvidence
  /** Deployment/status checks reject histories not represented by this checkout. */
  strict?: boolean
}

export interface MigrationAction {
  checksum: string
  filename: string
  kind: MigrationActionKind
  path: string
  source: string
  sourceVersion: string
}

export interface MigrationPlan {
  actions: readonly MigrationAction[]
  apply: number
  adopt: number
  recoveryPath?: string
  skip: number
}

export interface WranglerExecuteOptions {
  database: string
  json?: boolean
  location: MigrationLocation
  sql: string
}

export interface MigrationRunOptions {
  configFile: string
  cwd?: string
  database: string
  location: MigrationLocation
  recoveryDir?: string
  /** Explicit local D1 state; never used for remote operations. */
  persistTo?: string
  target?: { accountId: string; databaseId: string }
  reset?: boolean
  /** Explicit target, bypassing Wrangler's build-output config redirect. */
  wranglerConfig?: string
  strict?: boolean
}

export interface MigrationRecoverySnapshot {
  capturedAt: string
  database: string
  legacyLedger: readonly MigrationLedgerRow[]
  migrationLedger: readonly MigrationLedgerRow[]
  schema: ReadonlyArray<{ name?: string; sql?: string; type?: string }>
  timeTravelBookmark: string
  target?: { accountId: string; databaseId: string }
  lockOwner?: string
}

export function validateMigrationReset(location: MigrationLocation, reset = false): boolean {
  if (location === '--remote' && reset) {
    throw new Error('Refusing remote migration reset; only an explicit local reset is allowed')
  }
  return location === '--local' && reset
}

interface RawMigrationSource {
  dir?: unknown
  directory?: unknown
  id?: unknown
  path?: unknown
  source?: unknown
  sourceVersion?: unknown
  version?: unknown
}

interface RawMigrationConfig {
  adoptions?: unknown
  schemaVersion?: unknown
  sources?: unknown
  version?: unknown
}

interface WranglerResult<T> {
  results: T[]
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function assertStableSource(source: string): void {
  const isScopedPackage = source.startsWith('@') && source.includes('/')
  const isPackageId = source.startsWith('package:')
  if (
    source.startsWith('bundle:') ||
    source.startsWith('layer:') ||
    (source.includes('/') && !isScopedPackage && !isPackageId) ||
    source.includes('\\')
  ) {
    throw new Error(`Migration source must be a stable explicit name: ${source}`)
  }
  if (source.endsWith('.sql') || source === 'bundle') {
    throw new Error(`Migration source cannot be a filename or ambiguous bundle: ${source}`)
  }
}

function normalizeEvidence(value: unknown, label: string): MigrationAdoptionEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}.evidence is required`)
  }
  const record = value as Record<string, unknown>
  const tables = Array.isArray(record.tables)
    ? record.tables.map((table) => requireText(table, `${label}.evidence.tables entry`))
    : []
  if (tables.length === 0) {
    throw new Error(`${label}.evidence.tables must contain at least one table`)
  }

  const columns = Array.isArray(record.columns)
    ? record.columns.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`${label}.evidence.columns[${index}] must be an object`)
        }
        const column = entry as Record<string, unknown>
        return {
          column: requireText(column.column, `${label}.evidence.columns[${index}].column`),
          table: requireText(column.table, `${label}.evidence.columns[${index}].table`),
        }
      })
    : []

  const indexes = Array.isArray(record.indexes)
    ? record.indexes.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`${label}.evidence.indexes[${index}] must be an object`)
        }
        const schemaIndex = entry as Record<string, unknown>
        return {
          name: requireText(schemaIndex.name, `${label}.evidence.indexes[${index}].name`),
          table: requireText(schemaIndex.table, `${label}.evidence.indexes[${index}].table`),
        }
      })
    : []

  return { columns, indexes, tables }
}

function normalizeAdoption(value: unknown, index: number): MigrationAdoptionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`adoptions[${index}] must be an object`)
  }
  const record = value as Record<string, unknown>
  const legacyRecord =
    record.legacy && typeof record.legacy === 'object' && !Array.isArray(record.legacy)
      ? (record.legacy as Record<string, unknown>)
      : undefined

  const legacyFilename = legacyRecord
    ? requireText(legacyRecord.filename, `adoptions[${index}].legacy.filename`)
    : record.legacyFilename === undefined
      ? undefined
      : requireText(record.legacyFilename, `adoptions[${index}].legacyFilename`)
  const legacySource = legacyRecord
    ? legacyRecord.source === undefined
      ? undefined
      : requireText(legacyRecord.source, `adoptions[${index}].legacy.source`)
    : record.legacySource === undefined
      ? undefined
      : requireText(record.legacySource, `adoptions[${index}].legacySource`)

  if (!legacyFilename) {
    throw new Error(`adoptions[${index}] must identify a legacy filename`)
  }

  const source = requireText(record.source, `adoptions[${index}].source`)
  assertStableSource(source)
  return {
    checksum: requireText(record.checksum, `adoptions[${index}].checksum`),
    evidence: normalizeEvidence(record.evidence, `adoptions[${index}]`),
    filename: requireText(record.filename, `adoptions[${index}].filename`),
    legacy: { filename: legacyFilename, ...(legacySource ? { source: legacySource } : {}) },
    legacyFilename,
    ...(legacySource ? { legacySource } : {}),
    source,
    sourceVersion:
      record.sourceVersion === undefined && record.version === undefined
        ? DEFAULT_SOURCE_VERSION
        : requireText(record.sourceVersion ?? record.version, `adoptions[${index}].sourceVersion`),
  }
}

function normalizeSource(value: unknown, index: number): MigrationSourceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`sources[${index}] must be an object`)
  }
  const record = value as RawMigrationSource
  const source = requireText(record.source ?? record.id, `sources[${index}].source`)
  assertStableSource(source)
  return {
    path: requireText(record.path ?? record.dir ?? record.directory, `sources[${index}].path`),
    source,
    sourceVersion:
      record.sourceVersion === undefined && record.version === undefined
        ? DEFAULT_SOURCE_VERSION
        : requireText(record.sourceVersion ?? record.version, `sources[${index}].sourceVersion`),
  }
}

export function parseMigrationConfig(value: unknown): MigrationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Migration config must be a JSON object')
  }
  const record = value as RawMigrationConfig
  const schemaVersion = record.schemaVersion ?? record.version
  if (schemaVersion !== undefined && schemaVersion !== MIGRATION_CONFIG_VERSION) {
    throw new Error(`Migration config version must be ${MIGRATION_CONFIG_VERSION}`)
  }
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    throw new Error('Migration config sources must be a non-empty array')
  }

  const sources = record.sources.map(normalizeSource)
  const seenSources = new Set<string>()
  for (const source of sources) {
    if (seenSources.has(source.source))
      throw new Error(`Duplicate migration source: ${source.source}`)
    seenSources.add(source.source)
  }

  const adoptions = Array.isArray(record.adoptions) ? record.adoptions.map(normalizeAdoption) : []
  return { adoptions, schemaVersion: MIGRATION_CONFIG_VERSION, sources }
}

export function loadMigrationConfig(configFile: string): {
  baseDir: string
  config: MigrationConfig
} {
  const path = resolve(configFile)
  if (!existsSync(path)) throw new Error(`Migration config not found: ${path}`)
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Could not parse migration config ${path}: ${String(error)}`)
  }
  const baseDir = dirname(path)
  return {
    baseDir,
    config: resolveMigrationConfigVersions(parseMigrationConfig(value), baseDir),
  }
}

function isAppSource(source: string): boolean {
  return source === 'app' || source.startsWith('app:')
}

function readOwningPackageVersion(directory: string, source: string): string {
  let current = resolve(directory)
  const filesystemRoot = dirname(current) === current ? current : resolve(current, '/')
  while (true) {
    const manifestPath = join(current, 'package.json')
    if (existsSync(manifestPath) && statSync(manifestPath).isFile()) {
      let manifest: { name?: unknown; version?: unknown }
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          name?: unknown
          version?: unknown
        }
      } catch (error) {
        throw new Error(
          `Could not parse migration owner manifest ${manifestPath}: ${String(error)}`,
        )
      }
      const packageName = typeof manifest.name === 'string' ? manifest.name : undefined
      const ownsSource = source.startsWith('@') ? packageName === source : true
      if (ownsSource) {
        return requireText(manifest.version, `Migration owner ${manifestPath} version`)
      }
    }
    if (current === filesystemRoot || dirname(current) === current) break
    current = dirname(current)
  }
  throw new Error(
    `Could not resolve source version for ${source} from an owning package.json above ${directory}`,
  )
}

export function resolveMigrationConfigVersions(
  config: MigrationConfig,
  baseDir: string,
): MigrationConfig {
  const sources = config.sources.map((source) => ({
    ...source,
    sourceVersion:
      source.sourceVersion === DEFAULT_SOURCE_VERSION
        ? readOwningPackageVersion(resolve(baseDir, source.path), source.source)
        : source.sourceVersion,
  }))
  const versions = new Map(sources.map((source) => [source.source, source.sourceVersion]))
  const adoptions = config.adoptions.map((adoption) => ({
    ...adoption,
    sourceVersion:
      adoption.sourceVersion === DEFAULT_SOURCE_VERSION
        ? (versions.get(adoption.source) ?? DEFAULT_SOURCE_VERSION)
        : adoption.sourceVersion,
  }))
  for (const adoption of adoptions) {
    if (adoption.sourceVersion === DEFAULT_SOURCE_VERSION) {
      throw new Error(`Could not resolve source version for adoption ${adoption.source}`)
    }
  }
  return { ...config, adoptions, sources }
}

export function orderMigrationSources(
  sources: readonly MigrationSourceConfig[],
): MigrationSourceConfig[] {
  return sources
    .map((source, index) => ({ index, source }))
    .sort((left, right) => {
      const leftRank = isAppSource(left.source.source) ? 1 : 0
      const rightRank = isAppSource(right.source.source) ? 1 : 0
      return leftRank - rightRank || left.index - right.index
    })
    .map(({ source }) => source)
}

export function checksumMigrationSql(sql: string): string {
  return createHash('sha256').update(sql).digest('hex')
}

export function discoverMigrations(config: MigrationConfig, baseDir: string): MigrationFile[] {
  const files: MigrationFile[] = []
  const resolvedConfig = resolveMigrationConfigVersions(config, baseDir)
  for (const source of orderMigrationSources(resolvedConfig.sources)) {
    const directory = resolve(baseDir, source.path)
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      throw new Error(`Migration directory not found for ${source.source}: ${directory}`)
    }
    const names = readdirSync(directory)
      .filter((name) => /^\d{4,}(?:_\w[\w.-]*)?\.sql$/i.test(name))
      .sort((left, right) => left.localeCompare(right))
    for (const filename of names) {
      const path = join(directory, filename)
      if (!statSync(path).isFile()) continue
      const sql = readFileSync(path)
      files.push({
        checksum: checksumMigrationSql(sql.toString()),
        filename: basename(path),
        path,
        source: source.source,
        sourceVersion: source.sourceVersion,
      })
    }
  }
  return files
}

function isStableLedgerRow(row: MigrationLedgerRow): boolean {
  const source = row.source?.trim() ?? ''
  return (
    source === 'app' ||
    source.startsWith('app:') ||
    source.startsWith('package:') ||
    source.startsWith('@')
  )
}

function legacyRowKey(row: MigrationLedgerRow): string {
  return row.source ? `${row.source}:${row.filename}` : row.filename
}

function adoptionLegacyKey(adoption: MigrationAdoptionConfig): string {
  const source = adoption.legacySource ?? adoption.legacy?.source
  const filename = adoption.legacyFilename ?? adoption.legacy?.filename
  return source ? `${source}:${filename}` : (filename ?? '')
}

function assertSchemaEvidence(
  adoption: MigrationAdoptionConfig,
  schemaEvidence: MigrationSchemaEvidence | undefined,
): void {
  if (!schemaEvidence) {
    throw new Error(
      `Legacy migration ${adoptionLegacyKey(adoption)} requires explicit schema probe evidence`,
    )
  }
  const tables = new Set(schemaEvidence.tables)
  for (const table of adoption.evidence.tables) {
    if (!tables.has(table)) {
      throw new Error(`Schema adoption probe did not find table ${table}`)
    }
  }
  const columns = new Set(schemaEvidence.columns.map((entry) => `${entry.table}:${entry.column}`))
  for (const entry of adoption.evidence.columns ?? []) {
    if (!columns.has(`${entry.table}:${entry.column}`)) {
      throw new Error(`Schema adoption probe did not find column ${entry.table}.${entry.column}`)
    }
  }
  const indexes = new Set(schemaEvidence.indexes.map((entry) => `${entry.table}:${entry.name}`))
  for (const entry of adoption.evidence.indexes ?? []) {
    if (!indexes.has(`${entry.table}:${entry.name}`)) {
      throw new Error(`Schema adoption probe did not find index ${entry.table}.${entry.name}`)
    }
  }
}

export function planMigrations(input: MigrationPlanningInput): MigrationPlan {
  const migrations = [...input.migrations]
  const seenIds = new Set<string>()
  for (const migration of migrations) {
    const id = `${migration.source}\0${migration.filename}`
    if (seenIds.has(id))
      throw new Error(`Duplicate migration identity: ${migration.source}:${migration.filename}`)
    seenIds.add(id)
  }

  const migrationById = new Map(
    migrations.map((migration) => [`${migration.source}\0${migration.filename}`, migration]),
  )
  const stableRows = new Map<string, MigrationLedgerRow>()
  const ambiguousRows: MigrationLedgerRow[] = []
  for (const row of input.ledgerRows ?? []) {
    if (!row.filename) throw new Error('Migration ledger contains a row without a filename')
    if (isStableLedgerRow(row)) {
      const id = `${row.source}\0${row.filename}`
      if (stableRows.has(id))
        throw new Error(`Duplicate migration ledger row: ${legacyRowKey(row)}`)
      stableRows.set(id, row)
    } else {
      ambiguousRows.push(row)
    }
  }

  const adoptions = input.adoptions ?? []
  const adoptionByLegacyKey = new Map<string, MigrationAdoptionConfig>()
  if (input.strict) {
    for (const [id, row] of stableRows) {
      if (!migrationById.has(id)) {
        throw new Error(`Applied migration is absent from this checkout: ${legacyRowKey(row)}`)
      }
    }
  }
  for (const adoption of adoptions) {
    const key = adoptionLegacyKey(adoption)
    if (!key || adoptionByLegacyKey.has(key))
      throw new Error(`Duplicate migration adoption: ${key}`)
    adoptionByLegacyKey.set(key, adoption)
    const target = migrationById.get(`${adoption.source}\0${adoption.filename}`)
    if (!target)
      throw new Error(
        `Adoption target is not in the migration sources: ${adoption.source}:${adoption.filename}`,
      )
    if (target.checksum !== adoption.checksum) {
      throw new Error(`Adoption checksum does not match ${adoption.source}:${adoption.filename}`)
    }
  }

  for (const row of ambiguousRows) {
    const key = legacyRowKey(row)
    const adoption = adoptionByLegacyKey.get(key)
    if (!adoption) {
      throw new Error(`Ambiguous legacy migration row refused: ${key}`)
    }
    const target = migrationById.get(`${adoption.source}\0${adoption.filename}`)!
    // The stable checksum receipt supersedes historical schema probes. A later
    // reviewed migration may remove a cutover table or arrive in a new package.
    if (!stableRows.has(`${adoption.source}\0${adoption.filename}`)) {
      if (target.sourceVersion !== adoption.sourceVersion) {
        throw new Error(
          `Adoption source version does not match ${adoption.source}:${adoption.filename}`,
        )
      }
      assertSchemaEvidence(adoption, input.schemaEvidence)
    }
  }

  const adoptedIds = new Set(
    ambiguousRows
      .map((row) => adoptionByLegacyKey.get(legacyRowKey(row)))
      .filter((adoption): adoption is MigrationAdoptionConfig => adoption !== undefined)
      .map((adoption) => `${adoption.source}\0${adoption.filename}`),
  )

  const actions = migrations.map<MigrationAction>((migration) => {
    const id = `${migration.source}\0${migration.filename}`
    const row = stableRows.get(id)
    if (row) {
      if (row.checksum !== migration.checksum) {
        throw new Error(`Migration checksum changed for ${migration.source}:${migration.filename}`)
      }
      return { ...migration, kind: 'skip' }
    }
    return { ...migration, kind: adoptedIds.has(id) ? 'adopt' : 'apply' }
  })

  if (input.strict) {
    const pendingSources = new Set<string>()
    for (const action of actions) {
      if (action.kind === 'apply') pendingSources.add(action.source)
      else if (action.kind === 'skip' && pendingSources.has(action.source)) {
        throw new Error(`Migration history has a gap before ${action.source}:${action.filename}`)
      }
    }
  }

  return {
    actions,
    apply: actions.filter((action) => action.kind === 'apply').length,
    adopt: actions.filter((action) => action.kind === 'adopt').length,
    skip: actions.filter((action) => action.kind === 'skip').length,
  }
}

export const buildMigrationPlan = planMigrations

export function migrationLedgerCreateSql(): string {
  return `CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (source TEXT NOT NULL, filename TEXT NOT NULL, checksum TEXT NOT NULL, source_version TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (source, filename));`
}

export function migrationLedgerInfoSql(): string {
  return `PRAGMA table_info(${MIGRATION_LEDGER_TABLE});`
}

export function migrationLedgerRowsSql(): string {
  return `SELECT source, filename, checksum, source_version, applied_at FROM ${MIGRATION_LEDGER_TABLE} ORDER BY source, filename;`
}

export function migrationLegacyTablesSql(): string {
  return "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_applied_migrations';"
}

export function buildWranglerD1ExecuteArgs(options: WranglerExecuteOptions): string[] {
  const args = ['d1', 'execute', options.database, options.location]
  if (options.json) args.push('--json')
  args.push('--command', options.sql)
  return args
}

export function buildWranglerD1FileArgs(options: {
  database: string
  file: string
  location: MigrationLocation
}): string[] {
  return ['d1', 'execute', options.database, options.location, `--file=${options.file}`]
}

export function buildWranglerTimeTravelInfoArgs(database: string): string[] {
  return ['d1', 'time-travel', 'info', database, '--json']
}

export function parseWranglerJson<T>(output: string): WranglerResult<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error('Wrangler returned invalid JSON while inspecting D1')
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  if (entries.length === 0) throw new Error('Wrangler returned no D1 query result')
  const results = entries.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      ('success' in entry && entry.success !== true) ||
      !('results' in entry) ||
      !Array.isArray(entry.results)
    ) {
      throw new Error('Wrangler returned an unsuccessful or malformed D1 query result')
    }
    return entry.results
  }) as T[]
  return { results }
}

function runWrangler(args: string[], cwd: string, json: boolean): string {
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
  return json ? result.stdout : ''
}

/** Injectable at the process boundary so the real SQL protocol is testable. */
export type MigrationExecutor = (args: string[], cwd: string, json: boolean) => string

interface MigrationDatabase {
  rows<T>(sql: string): T[]
  execute(sql: string): void
  file(path: string): void
  bookmark(): string
}

function migrationDatabase(
  options: Omit<MigrationRunOptions, 'configFile'>,
  executor: MigrationExecutor,
): MigrationDatabase {
  const cwd = resolve(options.cwd ?? process.cwd())
  if (options.persistTo && options.location !== '--local')
    throw new Error('Local state cannot select a remote migration target')
  const run = (args: string[], json: boolean) => {
    const targetArgs = options.wranglerConfig
      ? [...args, '--config', resolve(cwd, options.wranglerConfig)]
      : args
    return executor(
      options.persistTo
        ? [...targetArgs, '--persist-to', resolve(cwd, options.persistTo)]
        : targetArgs,
      cwd,
      json,
    )
  }
  const args = (sql: string, json: boolean) =>
    buildWranglerD1ExecuteArgs({
      database: options.database,
      location: options.location,
      sql,
      json,
    })
  return {
    rows: <T>(sql: string) => parseWranglerJson<T>(run(args(sql, true), true)).results,
    execute: (sql) => {
      run(args(sql, false), false)
    },
    file: (file) => {
      run(buildWranglerD1FileArgs({ ...options, file }), false)
    },
    bookmark: () =>
      parseTimeTravelBookmark(run(buildWranglerTimeTravelInfoArgs(options.database), true)),
  }
}

function validateLedgerSchema(rows: Array<{ name?: string; pk?: number; type?: string }>): void {
  const expected = new Map([
    ['source', 1],
    ['filename', 2],
  ])
  for (const column of rows) {
    if (
      (column.name === 'source' || column.name === 'filename') &&
      column.pk !== expected.get(column.name)
    ) {
      throw new Error('Existing _narduk_migrations table has an incompatible primary key')
    }
  }
  const names = new Set(rows.map((row) => row.name))
  for (const name of ['source', 'filename', 'checksum', 'source_version', 'applied_at']) {
    if (!names.has(name)) throw new Error(`Existing _narduk_migrations table is missing ${name}`)
  }
}

function validateIdentifier(value: string): void {
  if (!/^[A-Za-z_]\w*$/u.test(value)) throw new Error(`Unsafe schema identifier: ${value}`)
}

function readSchemaEvidence(
  config: MigrationConfig,
  db: MigrationDatabase,
): MigrationSchemaEvidence | undefined {
  if (config.adoptions.length === 0) return undefined
  const tables = [...new Set(config.adoptions.flatMap((adoption) => adoption.evidence.tables))]
  for (const table of tables) validateIdentifier(table)
  const tableRows = db.rows<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${tables.map(quoteSql).join(', ')});`,
  )
  const columns: Array<{ column: string; table: string }> = []
  const indexes: Array<{ name: string; table: string }> = []
  for (const table of tables) {
    for (const row of db.rows<{ name: string }>(`PRAGMA table_info(${table});`)) {
      columns.push({ column: row.name, table })
    }
    for (const row of db.rows<{ name: string }>(`PRAGMA index_list(${table});`)) {
      indexes.push({ name: row.name, table })
    }
  }
  return { columns, indexes, tables: tableRows.map((row) => row.name) }
}

function readLegacyRows(db: MigrationDatabase, tables: Set<string>): MigrationLedgerRow[] {
  const rows: MigrationLedgerRow[] = []
  if (tables.has('_applied_migrations')) {
    for (const row of db.rows<{ filename: string }>(
      'SELECT filename FROM _applied_migrations ORDER BY filename;',
    )) {
      rows.push({ filename: requireText(row.filename, 'Legacy filename'), source: null })
    }
  }
  // A distinct source prevents identical filenames from two legacy ledgers
  // being silently treated as the same adoption evidence.
  if (tables.has('d1_migrations')) {
    for (const row of db.rows<{ name: string }>('SELECT name FROM d1_migrations ORDER BY name;')) {
      rows.push({ filename: requireText(row.name, 'Wrangler migration name'), source: 'wrangler' })
    }
  }
  return rows
}

function quoteSql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function recordMigrationSql(action: MigrationAction): string {
  return `INSERT INTO ${MIGRATION_LEDGER_TABLE} (source, filename, checksum, source_version, applied_at) VALUES (${quoteSql(action.source)}, ${quoteSql(action.filename)}, ${quoteSql(action.checksum)}, ${quoteSql(action.sourceVersion)}, datetime('now'));`
}

export function buildMigrationBatchSql(action: MigrationAction, migrationSql: string): string {
  // The source can have changed since discovery (including a symlink target).
  if (checksumMigrationSql(migrationSql) !== action.checksum) {
    throw new Error(`Migration changed after planning: ${action.source}:${action.filename}`)
  }
  if (/_narduk_migration/iu.test(migrationSql))
    throw new Error('Migration SQL may not alter the runner ledger or lock')
  return `${migrationSql.trimEnd()}\n${recordMigrationSql(action)}\n`
}

export function parseTimeTravelBookmark(output: string): string {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Wrangler returned invalid JSON while capturing the D1 recovery bookmark')
  }
  const entry = Array.isArray(value) ? value[0] : value
  const bookmark =
    entry && typeof entry === 'object' ? (entry as { bookmark?: unknown }).bookmark : undefined
  if (typeof bookmark !== 'string' || bookmark.trim() === '') {
    throw new Error('Wrangler did not return a D1 Time Travel bookmark')
  }
  return bookmark.trim()
}

function writeRecoverySnapshot(snapshot: MigrationRecoverySnapshot, recoveryDir: string): string {
  mkdirSync(recoveryDir, { recursive: true })
  const timestamp = snapshot.capturedAt.replaceAll(/[:.]/gu, '-')
  const safeDatabase = snapshot.database.replaceAll(/[^\w.-]/gu, '_')
  const path = join(recoveryDir, `${safeDatabase}-${timestamp}.json`)
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return path
}

function captureRemoteRecoveryState(
  db: MigrationDatabase,
  database: string,
  recoveryDir: string,
  lockOwner: string,
  target?: MigrationRunOptions['target'],
): string {
  const timeTravelBookmark = db.bookmark()
  const schema = db.rows<{ name: string; sql: string; type: string }>(
    "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view') ORDER BY type, name;",
  )
  const names = new Set(schema.map((entry) => entry.name))
  return writeRecoverySnapshot(
    {
      capturedAt: new Date().toISOString(),
      database,
      schema,
      timeTravelBookmark,
      lockOwner,
      ...(target ? { target } : {}),
      migrationLedger: names.has(MIGRATION_LEDGER_TABLE)
        ? db.rows<MigrationLedgerRow>(migrationLedgerRowsSql())
        : [],
      legacyLedger: readLegacyRows(db, names),
    },
    recoveryDir,
  )
}

function inspectDatabase(options: MigrationRunOptions, db: MigrationDatabase): MigrationPlan {
  const loaded = loadMigrationConfig(resolve(options.cwd ?? process.cwd(), options.configFile))
  const config = resolveMigrationConfigVersions(loaded.config, loaded.baseDir)
  const migrations = discoverMigrations(config, loaded.baseDir)
  const tables = new Set(
    db
      .rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table';")
      .map((row) => row.name),
  )
  let stableRows: MigrationLedgerRow[] = []
  if (tables.has(MIGRATION_LEDGER_TABLE)) {
    validateLedgerSchema(db.rows(migrationLedgerInfoSql()))
    stableRows = db.rows<MigrationLedgerRow>(migrationLedgerRowsSql())
  }
  const legacyRows = readLegacyRows(db, tables)
  const applicationTables = [...tables].filter((name) => !isMigrationMetadata(name))
  if (
    (options.strict ?? true) &&
    stableRows.length === 0 &&
    legacyRows.length === 0 &&
    applicationTables.length > 0
  ) {
    throw new Error(
      'Existing application schema has no migration history; explicit reviewed baseline evidence is required before migration or a current-status claim',
    )
  }
  return planMigrations({
    adoptions: config.adoptions,
    migrations,
    ledgerRows: [...stableRows, ...legacyRows],
    schemaEvidence: readSchemaEvidence(config, db),
    strict: options.strict ?? true,
  })
}

/** No CREATE, lock, recovery capture, or ledger write; usable with D1 Read. */
export function inspectMigrations(
  options: MigrationRunOptions,
  executor: MigrationExecutor = runWrangler,
): MigrationPlan {
  if (options.reset) throw new Error('A read-only migration status cannot reset a database')
  const db = migrationDatabase(options, executor)
  const assertUnlocked = () => {
    const tables = db.rows<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${MIGRATION_LOCK_TABLE}';`,
    )
    if (tables.length && db.rows(`SELECT owner FROM ${MIGRATION_LOCK_TABLE} LIMIT 1;`).length) {
      throw new Error(
        `D1 migration is locked for ${options.database}; status is not proven current`,
      )
    }
  }
  assertUnlocked()
  const plan = inspectDatabase(options, db)
  assertUnlocked()
  return plan
}

function applyMigrationAndRecord(action: MigrationAction, db: MigrationDatabase): void {
  const directory = mkdtempSync(join(tmpdir(), 'narduk-app-migration-'))
  const path = join(directory, action.filename)
  try {
    writeFileSync(path, buildMigrationBatchSql(action, readFileSync(action.path, 'utf8')), 'utf8')
    db.file(path)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

/**
 * A singleton row lives in the database itself, so different repos, runners,
 * hosts, binding aliases and preview jobs contend on the same lock. No TTL:
 * a timed-out client does not prove that Cloudflare stopped its remote import.
 * Legacy/external writers must be retired before claiming serialization.
 */
export function runMigrations(
  options: MigrationRunOptions,
  executor: MigrationExecutor = runWrangler,
): MigrationPlan {
  const resetLocal = validateMigrationReset(options.location, options.reset)
  const cwd = resolve(options.cwd ?? process.cwd())
  if (resetLocal)
    rmSync(
      join(
        options.persistTo ? resolve(cwd, options.persistTo) : join(cwd, '.wrangler', 'state'),
        'v3',
        'd1',
      ),
      { force: true, recursive: true },
    )
  const db = migrationDatabase(options, executor)
  // Fail on history conflicts and bad manifests before taking any remote mutation path.
  inspectDatabase(options, db)
  return withMigrationLock(options, db, (owner) => {
    const plan = inspectDatabase(options, db)
    const recoveryPath =
      options.location === '--remote' && plan.apply + plan.adopt > 0
        ? captureRemoteRecoveryState(
            db,
            options.database,
            resolve(options.recoveryDir ?? join(cwd, '.narduk', 'recovery', 'd1')),
            owner,
            options.target,
          )
        : undefined
    if (plan.apply + plan.adopt > 0) db.execute(migrationLedgerCreateSql())
    for (const action of plan.actions) {
      if (action.kind === 'apply') applyMigrationAndRecord(action, db)
      else if (action.kind === 'adopt') db.execute(recordMigrationSql(action))
    }
    const after = inspectDatabase(options, db)
    if (after.apply + after.adopt !== 0)
      throw new Error('D1 migrations remain pending after application')
    return { ...plan, ...(recoveryPath ? { recoveryPath } : {}) }
  })
}

function withMigrationLock<T>(
  options: MigrationRunOptions,
  db: MigrationDatabase,
  operation: (owner: string) => T,
): T {
  const owner = randomUUID()
  db.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_LOCK_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, acquired_at TEXT NOT NULL);`,
  )
  try {
    db.execute(
      `INSERT INTO ${MIGRATION_LOCK_TABLE} (id, owner, acquired_at) VALUES (1, ${quoteSql(owner)}, datetime('now'));`,
    )
  } catch {
    // INSERT may have succeeded despite a lost response. Never release an
    // uncertain acquisition, and never disclose raw provider output here.
    throw new Error(
      `Could not acquire D1 migration lock for ${options.database}; attempted owner ${owner}. Inspect ${MIGRATION_LOCK_TABLE} and the prior run before recovery.`,
    )
  }
  let complete = false
  try {
    const result = operation(owner)
    complete = true
    return result
  } catch (error) {
    throw new Error(
      `D1 migration failed for ${options.database}; ${options.location === '--remote' ? `lock owner ${owner} retained. Inspect remote state and recovery artifacts before retrying.` : 'local run stopped.'} Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  } finally {
    if (complete || options.location === '--local') {
      db.execute(`DELETE FROM ${MIGRATION_LOCK_TABLE} WHERE id = 1 AND owner = ${quoteSql(owner)};`)
    }
  }
}

export interface MigrationBaselineCaptureOptions extends Omit<MigrationRunOptions, 'configFile'> {
  revision: string
  target: { accountId: string; databaseId: string }
}

function assertDatabaseUnlocked(db: MigrationDatabase, database: string): void {
  const tables = db.rows<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${MIGRATION_LOCK_TABLE}';`,
  )
  if (tables.length && db.rows(`SELECT owner FROM ${MIGRATION_LOCK_TABLE} LIMIT 1;`).length) {
    throw new Error(`D1 migration is locked for ${database}; cutover evidence is not stable`)
  }
}

function readBaselineState(
  options: MigrationBaselineCaptureOptions,
  db: MigrationDatabase,
): MigrationBaseline {
  const tables = new Set(
    db
      .rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table';")
      .map((row) => row.name),
  )
  if (tables.has(MIGRATION_LEDGER_TABLE)) validateLedgerSchema(db.rows(migrationLedgerInfoSql()))
  return createMigrationBaseline({
    schemaVersion: 1,
    kind: 'narduk-d1-cutover',
    capturedAt: new Date().toISOString(),
    revision: options.revision,
    origin: options.target,
    objects: db.rows<MigrationBaselineObject>(
      "SELECT type, name, tbl_name AS 'table', sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') AND sql IS NOT NULL;",
    ),
    migrations: tables.has(MIGRATION_LEDGER_TABLE)
      ? db.rows<{ source: string; filename: string; checksum: string; sourceVersion: string }>(
          `SELECT source, filename, checksum, source_version AS sourceVersion FROM ${MIGRATION_LEDGER_TABLE};`,
        )
      : [],
    legacy: readLegacyRows(db, tables).map((row) => ({
      filename: row.filename,
      source: row.source === 'wrangler' ? 'wrangler' : null,
    })),
  })
}

/** Schema and ledger metadata only. No writes, package replay, or application rows. */
export function captureMigrationBaseline(
  options: MigrationBaselineCaptureOptions,
  executor: MigrationExecutor = runWrangler,
): MigrationBaseline {
  if (options.reset) throw new Error('Baseline capture cannot reset a database')
  const db = migrationDatabase(options, executor)
  assertDatabaseUnlocked(db, options.database)
  const artifact = readBaselineState(options, db)
  assertBaselineState(artifact, readBaselineState(options, db))
  assertDatabaseUnlocked(db, options.database)
  return artifact
}

export interface MigrationBaselineRegistrationOptions extends MigrationRunOptions {
  target: { accountId: string; databaseId: string }
  source: string
  filename: string
  expectedDigest: string
  reviewRef: string
}

function baselineAction(
  options: Pick<MigrationBaselineRegistrationOptions, 'configFile' | 'cwd' | 'source' | 'filename'>,
  artifact: MigrationBaseline,
): MigrationAction {
  if (artifact.migrations.length || artifact.legacy.length) {
    throw new Error(
      'Baseline registration is only for untracked schemas; preserve and adopt existing histories',
    )
  }
  const loaded = loadMigrationConfig(resolve(options.cwd ?? process.cwd(), options.configFile))
  const config = resolveMigrationConfigVersions(loaded.config, loaded.baseDir)
  // A new app-owned schema snapshot is not an attestation that a package's
  // historical INSERT/UPDATE/DELETE statements ran. Never invent those receipts.
  if (config.sources.length !== 1 || config.adoptions.length || !isAppSource(options.source)) {
    throw new Error(
      'An untracked database needs one dedicated app-owned baseline source, not inferred package history',
    )
  }
  const first = discoverMigrations(config, loaded.baseDir)[0]
  if (!first || first.source !== options.source || first.filename !== options.filename) {
    throw new Error('The reviewed schema baseline must be the first migration in its source')
  }
  if (first.checksum !== checksumMigrationSql(migrationBaselineSql(artifact))) {
    throw new Error('Baseline migration must exactly match the artifact schema SQL')
  }
  return { ...first, kind: 'adopt' }
}

/** One-time, reviewed metadata registration. Never executes captured schema on the target. */
export function registerMigrationBaseline(
  options: MigrationBaselineRegistrationOptions,
  input: MigrationBaseline,
  executor: MigrationExecutor = runWrangler,
): { baseline: string; recoveryPath?: string } {
  const artifact = parseMigrationBaseline(input)
  if (options.reset) throw new Error('Baseline registration cannot reset a database')
  if (options.expectedDigest !== artifact.digest)
    throw new Error('Explicit reviewed baseline digest does not match')
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:#.*)?$/u.test(options.reviewRef)) {
    throw new Error('Baseline registration requires the review PR URL as --review-ref')
  }
  baselineAction(options, artifact)
  const db = migrationDatabase(options, executor)
  const stateOptions = { ...options, revision: artifact.revision }
  assertDatabaseUnlocked(db, options.database)
  assertBaselineState(artifact, readBaselineState(stateOptions, db))
  return withMigrationLock(options, db, (owner) => {
    assertBaselineState(artifact, readBaselineState(stateOptions, db))
    const action = baselineAction(options, artifact)
    const recoveryPath =
      options.location === '--remote'
        ? captureRemoteRecoveryState(
            db,
            options.database,
            resolve(
              options.recoveryDir ??
                join(options.cwd ?? process.cwd(), '.narduk', 'recovery', 'd1'),
            ),
            owner,
            options.target,
          )
        : undefined
    const directory = mkdtempSync(join(tmpdir(), 'narduk-baseline-registration-'))
    try {
      const file = join(directory, 'register.sql')
      writeFileSync(
        file,
        [
          migrationLedgerCreateSql(),
          `CREATE TABLE IF NOT EXISTS ${BASELINE_RECEIPTS_TABLE} (digest TEXT PRIMARY KEY, source TEXT NOT NULL, filename TEXT NOT NULL, review_ref TEXT NOT NULL, account_id TEXT NOT NULL, database_id TEXT NOT NULL, registered_at TEXT NOT NULL);`,
          recordMigrationSql(action),
          `INSERT INTO ${BASELINE_RECEIPTS_TABLE} VALUES (${quoteSql(artifact.digest)}, ${quoteSql(action.source)}, ${quoteSql(action.filename)}, ${quoteSql(options.reviewRef)}, ${quoteSql(options.target.accountId)}, ${quoteSql(options.target.databaseId)}, datetime('now'));`,
        ].join('\n'),
        { mode: 0o600 },
      )
      db.file(file)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
    const after = readBaselineState(stateOptions, db)
    if (
      JSON.stringify(after.objects) !== JSON.stringify(artifact.objects) ||
      after.migrations.length !== 1 ||
      after.migrations[0]?.checksum !== action.checksum
    ) {
      throw new Error(
        'Baseline registration postcondition failed; inspect target and recovery evidence',
      )
    }
    return { baseline: artifact.digest, ...(recoveryPath ? { recoveryPath } : {}) }
  })
}

export interface MigrationBaselineProofOptions {
  cwd?: string
  configFile: string
  source?: string
  filename?: string
}

/** Rebuild the cutover shape, then run today's migrations. Only disposable local D1 is written. */
export function proveMigrationBaseline(
  input: MigrationBaseline,
  options: MigrationBaselineProofOptions,
  executor: MigrationExecutor = runWrangler,
): MigrationPlan {
  const artifact = parseMigrationBaseline(input)
  const cwd = resolve(options.cwd ?? process.cwd())
  const directory = mkdtempSync(join(tmpdir(), 'narduk-baseline-proof-'))
  const wranglerConfig = join(directory, 'wrangler.json')
  const local: MigrationRunOptions = {
    cwd,
    configFile: resolve(cwd, options.configFile),
    database: 'BASELINE_PROOF',
    location: '--local',
    wranglerConfig,
  }
  const isolated: MigrationExecutor = (args, _cwd, json) => {
    if (!args.includes('--local') || args.includes('--remote'))
      throw new Error('Baseline proof is local-only')
    return executor([...args, '--persist-to', join(directory, 'state')], cwd, json)
  }
  try {
    writeFileSync(
      wranglerConfig,
      JSON.stringify({
        name: 'narduk-baseline-proof',
        compatibility_date: '2026-09-01',
        d1_databases: [
          { binding: local.database, database_name: 'baseline-proof', database_id: randomUUID() },
        ],
      }),
    )
    const db = migrationDatabase(local, isolated)
    const seed = [migrationBaselineSql(artifact)]
    if (artifact.migrations.length) {
      seed.push(migrationLedgerCreateSql())
      for (const row of artifact.migrations)
        seed.push(recordMigrationSql({ ...row, kind: 'skip', path: '' }))
    }
    for (const source of [null, 'wrangler'] as const) {
      const rows = artifact.legacy.filter((row) => row.source === source)
      if (!rows.length) continue
      const table = source === null ? '_applied_migrations' : 'd1_migrations'
      const column = source === null ? 'filename' : 'name'
      seed.push(`CREATE TABLE ${table} (${column} TEXT PRIMARY KEY);`)
      for (const row of rows) seed.push(`INSERT INTO ${table} VALUES (${quoteSql(row.filename)});`)
    }
    if (!artifact.migrations.length && !artifact.legacy.length) {
      if (!options.source || !options.filename)
        throw new Error('Untracked cutover proof requires the new baseline --source and --filename')
      const action = baselineAction(
        { ...local, source: options.source, filename: options.filename },
        artifact,
      )
      seed.push(migrationLedgerCreateSql(), recordMigrationSql(action))
    }
    const file = join(directory, 'cutover.sql')
    writeFileSync(file, seed.join('\n'), { mode: 0o600 })
    db.file(file)
    return runMigrations(local, isolated)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
