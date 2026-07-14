import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

export const MIGRATION_LEDGER_TABLE = '_narduk_migrations'
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
  reset?: boolean
}

export interface MigrationRecoverySnapshot {
  capturedAt: string
  database: string
  legacyLedger: readonly MigrationLedgerRow[]
  migrationLedger: readonly MigrationLedgerRow[]
  schema: ReadonlyArray<{ name?: string; sql?: string; type?: string }>
  timeTravelBookmark: string
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
  return { baseDir: dirname(path), config: parseMigrationConfig(value) }
}

function isAppSource(source: string): boolean {
  return source === 'app' || source.startsWith('app:')
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
  for (const source of orderMigrationSources(config.sources)) {
    const directory = resolve(baseDir, source.path)
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      throw new Error(`Migration directory not found for ${source.source}: ${directory}`)
    }
    const names = readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith('.sql'))
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
    if (target.sourceVersion !== adoption.sourceVersion) {
      throw new Error(
        `Adoption source version does not match ${adoption.source}:${adoption.filename}`,
      )
    }
    assertSchemaEvidence(adoption, input.schemaEvidence)
  }

  for (const row of ambiguousRows) {
    const key = legacyRowKey(row)
    if (!adoptionByLegacyKey.has(key)) {
      throw new Error(`Ambiguous legacy migration row refused: ${key}`)
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
  const results = entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const values = (entry as { results?: unknown }).results
    return Array.isArray(values) ? values : []
  }) as T[]
  return { results }
}

function runWrangler(args: string[], cwd: string, json: boolean): string {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw new Error(`Could not run pnpm exec wrangler: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `wrangler exited ${result.status}`).trim())
  }
  return json ? result.stdout : ''
}

function readD1Rows<T>(options: WranglerExecuteOptions, cwd: string): T[] {
  return parseWranglerJson<T>(
    runWrangler(buildWranglerD1ExecuteArgs({ ...options, json: true }), cwd, true),
  ).results
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
  database: string,
  location: MigrationLocation,
  cwd: string,
): MigrationSchemaEvidence | undefined {
  if (config.adoptions.length === 0) return undefined
  const tables = [...new Set(config.adoptions.flatMap((adoption) => adoption.evidence.tables))]
  for (const table of tables) validateIdentifier(table)
  const tablePlaceholders = tables.map((table) => `'${table.replaceAll("'", "''")}'`).join(', ')
  const tableRows = readD1Rows<{ name?: string }>(
    {
      database,
      location,
      sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${tablePlaceholders});`,
    },
    cwd,
  )
  const columns: Array<{ column: string; table: string }> = []
  const indexes: Array<{ name: string; table: string }> = []
  for (const table of tables) {
    const rows = readD1Rows<{ name?: string }>(
      { database, location, sql: `PRAGMA table_info(${table});` },
      cwd,
    )
    for (const row of rows) {
      if (row.name) columns.push({ column: row.name, table })
    }
    const indexRows = readD1Rows<{ name?: string }>(
      { database, location, sql: `PRAGMA index_list(${table});` },
      cwd,
    )
    for (const row of indexRows) {
      if (row.name) indexes.push({ name: row.name, table })
    }
  }
  return {
    columns,
    indexes,
    tables: tableRows.map((row) => row.name).filter((name): name is string => Boolean(name)),
  }
}

function readLegacyRows(
  database: string,
  location: MigrationLocation,
  cwd: string,
): MigrationLedgerRow[] {
  const tables = readD1Rows<{ name?: string }>(
    { database, location, sql: migrationLegacyTablesSql() },
    cwd,
  )
  if (tables.length === 0) return []
  const rows = readD1Rows<{ filename?: string }>(
    {
      database,
      location,
      sql: 'SELECT filename FROM _applied_migrations ORDER BY filename;',
    },
    cwd,
  )
  return rows
    .filter(
      (row): row is { filename: string } =>
        typeof row.filename === 'string' && row.filename.length > 0,
    )
    .map((row) => ({ filename: row.filename, source: null }))
}

function recordMigrationSql(action: MigrationAction): string {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  return `INSERT INTO ${MIGRATION_LEDGER_TABLE} (source, filename, checksum, source_version, applied_at) VALUES (${quote(action.source)}, ${quote(action.filename)}, ${quote(action.checksum)}, ${quote(action.sourceVersion)}, datetime('now'));`
}

export function buildMigrationBatchSql(action: MigrationAction, migrationSql: string): string {
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

function captureRemoteRecoveryState(database: string, cwd: string, recoveryDir: string): string {
  const timeTravelBookmark = parseTimeTravelBookmark(
    runWrangler(buildWranglerTimeTravelInfoArgs(database), cwd, true),
  )
  const schema = readD1Rows<{ name?: string; sql?: string; type?: string }>(
    {
      database,
      location: '--remote',
      sql: "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view') ORDER BY type, name;",
    },
    cwd,
  )
  const names = new Set(schema.map((entry) => entry.name))
  const migrationLedger = names.has(MIGRATION_LEDGER_TABLE)
    ? readD1Rows<MigrationLedgerRow>(
        { database, location: '--remote', sql: migrationLedgerRowsSql() },
        cwd,
      )
    : []
  const legacyLedger = names.has('_applied_migrations')
    ? readLegacyRows(database, '--remote', cwd)
    : []
  return writeRecoverySnapshot(
    {
      capturedAt: new Date().toISOString(),
      database,
      legacyLedger,
      migrationLedger,
      schema,
      timeTravelBookmark,
    },
    recoveryDir,
  )
}

function applyMigrationAndRecord(
  action: MigrationAction,
  database: string,
  location: MigrationLocation,
  cwd: string,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'narduk-app-migration-'))
  const path = join(directory, action.filename)
  try {
    writeFileSync(path, buildMigrationBatchSql(action, readFileSync(action.path, 'utf8')), 'utf8')
    runWrangler(buildWranglerD1FileArgs({ database, file: path, location }), cwd, false)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

export function runMigrations(options: MigrationRunOptions): MigrationPlan {
  const resetLocal = validateMigrationReset(options.location, options.reset)
  const cwd = resolve(options.cwd ?? process.cwd())
  const loaded = loadMigrationConfig(options.configFile)
  const migrations = discoverMigrations(loaded.config, loaded.baseDir)
  const recoveryPath =
    options.location === '--remote'
      ? captureRemoteRecoveryState(
          options.database,
          cwd,
          resolve(options.recoveryDir ?? join(cwd, '.narduk', 'recovery', 'd1')),
        )
      : undefined
  if (resetLocal)
    rmSync(join(cwd, '.wrangler', 'state', 'v3', 'd1'), { force: true, recursive: true })

  runWrangler(
    buildWranglerD1ExecuteArgs({
      database: options.database,
      location: options.location,
      sql: migrationLedgerCreateSql(),
    }),
    cwd,
    false,
  )
  const info = readD1Rows<{ name?: string; pk?: number; type?: string }>(
    {
      database: options.database,
      location: options.location,
      sql: migrationLedgerInfoSql(),
    },
    cwd,
  )
  validateLedgerSchema(info)
  const stableRows = readD1Rows<MigrationLedgerRow>(
    {
      database: options.database,
      location: options.location,
      sql: migrationLedgerRowsSql(),
    },
    cwd,
  )
  const legacyRows = readLegacyRows(options.database, options.location, cwd)
  const schemaEvidence = readSchemaEvidence(loaded.config, options.database, options.location, cwd)
  const plan = planMigrations({
    adoptions: loaded.config.adoptions,
    ledgerRows: [...stableRows, ...legacyRows],
    migrations,
    schemaEvidence,
  })

  for (const action of plan.actions) {
    if (action.kind === 'skip') continue
    if (action.kind === 'apply') {
      applyMigrationAndRecord(action, options.database, options.location, cwd)
      continue
    }
    runWrangler(
      buildWranglerD1ExecuteArgs({
        database: options.database,
        location: options.location,
        sql: recordMigrationSql(action),
      }),
      cwd,
      false,
    )
  }
  return { ...plan, ...(recoveryPath ? { recoveryPath } : {}) }
}
