/**
 * Diff a live PostgreSQL catalog against Drizzle `pg-core` table definitions.
 *
 * It answers one question: does applying the shipped `.sql` files produce
 * exactly the schema the Drizzle tables describe? Types, nullability, defaults,
 * primary keys, unique constraints, foreign keys (with ON DELETE), CHECK values
 * for text enums and secondary indexes are all compared, in both directions: an
 * object the database has and the schema does not is a difference too.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'

import type postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

/** Apply every `NNNN_*.sql` file in name order. Returns the names applied. */
export async function applyMigrationDirectory(sql: Sql, directory: string): Promise<string[]> {
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort()
  for (const file of files) await sql.unsafe(readFileSync(join(directory, file), 'utf8'))
  return files
}

const UDT_BY_SQL_TYPE: Record<string, string> = {
  bigint: 'int8',
  boolean: 'bool',
  integer: 'int4',
  serial: 'int4',
  text: 'text',
}

const ON_DELETE_CODE: Record<string, string> = {
  'no action': 'a',
  cascade: 'c',
  'set default': 'd',
  'set null': 'n',
  restrict: 'r',
}

interface ColumnRow {
  collation_name: string | null
  column_default: string | null
  column_name: string
  is_nullable: 'NO' | 'YES'
  table_name: string
  udt_name: string
}
interface ConstraintRow {
  columns: string[]
  conname: string
  contype: string
  def: string
  deltype: string
  ref_columns: string[] | null
  ref_table: string | null
  table_name: string
}
interface IndexRow {
  columns: string[]
  index_name: string
  is_unique: boolean
  partial: string | null
  table_name: string
}

const same = (a: readonly string[], b: readonly string[]) => a.join('\u0000') === b.join('\u0000')

function normalizeDefault(raw: string | null): string | null {
  if (raw === null) return null
  // `'[]'::text` -> `'[]'`, `false` -> `false`, `0` -> `0`
  return raw.replace(/::[a-z ]+(?:\[\])?$/u, '')
}

function enumValuesFromCheck(def: string): string[] {
  return [...def.matchAll(/'([^']+)'::text/gu)].map((match) => match[1] as string)
}

type TableConfig = ReturnType<typeof getTableConfig>
type Collations = Readonly<Record<string, string>>

interface Catalog {
  columns: ColumnRow[]
  constraints: ConstraintRow[]
  indexes: IndexRow[]
}

async function readCatalog(sql: Sql): Promise<Catalog> {
  const columns = await sql<ColumnRow[]>`
    SELECT table_name, column_name, udt_name, is_nullable, column_default, collation_name
    FROM information_schema.columns WHERE table_schema = 'public'`
  const constraints = await sql<ConstraintRow[]>`
    SELECT c.conrelid::regclass::text AS table_name, c.conname, c.contype::text AS contype,
      c.confdeltype::text AS deltype, pg_get_constraintdef(c.oid) AS def,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k (attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            ORDER BY k.ord) AS columns,
      CASE WHEN c.confrelid = 0 THEN NULL ELSE c.confrelid::regclass::text END AS ref_table,
      CASE WHEN c.confrelid = 0 THEN NULL ELSE ARRAY(
        SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k (attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
        ORDER BY k.ord) END AS ref_columns
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'`
  const indexes = await sql<IndexRow[]>`
    SELECT t.relname::text AS table_name, i.relname::text AS index_name,
      x.indisunique AS is_unique, pg_get_expr(x.indpred, x.indrelid) AS partial,
      ARRAY(SELECT a.attname::text FROM unnest(x.indkey::int2[]) WITH ORDINALITY k (attnum, ord)
            JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
            ORDER BY k.ord) AS columns
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND NOT x.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid)`
  return { columns, constraints, indexes }
}

function diffDefault(
  label: string,
  column: TableConfig['columns'][number],
  sqlType: string,
  rawDefault: string | null,
): string[] {
  const dbDefault = normalizeDefault(rawDefault)
  if (sqlType === 'serial') {
    return dbDefault?.startsWith('nextval(')
      ? []
      : [`${label}: serial column has no sequence default`]
  }
  if (column.default !== undefined && column.default !== null) {
    const expected =
      typeof column.default === 'string' ? `'${column.default}'` : String(column.default)
    return dbDefault === expected
      ? []
      : [`${label}: default is ${dbDefault}, schema says ${expected}`]
  }
  // A `$defaultFn` ISO timestamp may also exist as a database default.
  if (dbDefault !== null && !dbDefault.startsWith('to_char(')) {
    return [`${label}: database default ${dbDefault} is not in the schema`]
  }
  if (dbDefault?.startsWith('to_char(') && !column.defaultFn) {
    return [`${label}: database timestamp default has no $defaultFn in the schema`]
  }
  return []
}

function diffColumn(
  table: string,
  column: TableConfig['columns'][number],
  row: ColumnRow,
  tableConstraints: readonly ConstraintRow[],
  claimed: Set<string>,
  collations: Collations,
): string[] {
  const label = `${table}.${column.name}`
  const problems: string[] = []
  const sqlType = column.getSQLType()
  const expectedUdt = UDT_BY_SQL_TYPE[sqlType]
  if (expectedUdt === undefined)
    problems.push(`${label}: no catalog mapping for SQL type ${sqlType}`)
  else if (row.udt_name !== expectedUdt) {
    problems.push(`${label}: type is ${row.udt_name}, schema says ${sqlType} (${expectedUdt})`)
  }
  const expectedCollation = collations[label] ?? null
  if (row.collation_name !== expectedCollation) {
    problems.push(
      `${label}: collation is ${row.collation_name ?? 'the database default'}, expected ${expectedCollation ?? 'the database default'}`,
    )
  }
  const isPrimary = tableConstraints.some(
    (constraint) => constraint.contype === 'p' && constraint.columns.includes(column.name),
  )
  const expectNotNull = column.notNull || isPrimary
  if ((row.is_nullable === 'NO') !== expectNotNull) {
    problems.push(`${label}: nullable is ${row.is_nullable}, schema notNull is ${expectNotNull}`)
  }
  problems.push(...diffDefault(label, column, sqlType, row.column_default))

  if (column.enumValues) {
    const check = tableConstraints.find(
      (constraint) => constraint.contype === 'c' && same(constraint.columns, [column.name]),
    )
    if (!check) problems.push(`${label}: schema enum has no CHECK constraint`)
    else {
      claimed.add(check.conname)
      const values = enumValuesFromCheck(check.def)
      if (!same(values, column.enumValues)) {
        problems.push(`${label}: CHECK allows [${values}], schema enum is [${column.enumValues}]`)
      }
    }
  }
  return problems
}

function diffColumns(
  config: TableConfig,
  columns: readonly ColumnRow[],
  tableConstraints: readonly ConstraintRow[],
  claimed: Set<string>,
  collations: Collations,
): string[] {
  const table = config.name
  const problems: string[] = []
  const dbColumns = new Map(
    columns.filter((row) => row.table_name === table).map((row) => [row.column_name, row]),
  )
  for (const column of config.columns) {
    const row = dbColumns.get(column.name)
    if (!row) problems.push(`${table}.${column.name} is missing from the database`)
    else problems.push(...diffColumn(table, column, row, tableConstraints, claimed, collations))
  }
  const declared = new Set(config.columns.map((column) => column.name))
  for (const name of dbColumns.keys()) {
    if (!declared.has(name)) {
      problems.push(`database has column ${table}.${name} the schema does not declare`)
    }
  }
  return problems
}

function diffPrimaryKey(
  config: TableConfig,
  tableConstraints: readonly ConstraintRow[],
  claimed: Set<string>,
): string[] {
  const table = config.name
  const primaryColumns = config.columns
    .filter((column) => column.primary)
    .map((column) => column.name)
  const primary = tableConstraints.find((constraint) => constraint.contype === 'p')
  if (!primary) return [`${table}: no primary key`]
  claimed.add(primary.conname)
  return same(primary.columns, primaryColumns)
    ? []
    : [`${table}: primary key is (${primary.columns}), schema says (${primaryColumns})`]
}

/** Unique constraints: column-level `.unique()` and table-level `unique()`. */
function diffUniques(
  config: TableConfig,
  tableConstraints: readonly ConstraintRow[],
  claimed: Set<string>,
): string[] {
  const table = config.name
  const problems: string[] = []
  const expectedUniques = [
    ...config.columns
      .filter((column) => column.isUnique)
      .map((column) => ({ columns: [column.name], name: column.uniqueName })),
    ...config.uniqueConstraints.map((unique) => ({
      columns: unique.columns.map((column) => column.name),
      name: unique.name,
    })),
  ]
  for (const unique of expectedUniques) {
    const found = tableConstraints.find(
      (constraint) => constraint.contype === 'u' && same(constraint.columns, unique.columns),
    )
    if (!found) {
      problems.push(`${table}: missing unique constraint on (${unique.columns})`)
      continue
    }
    claimed.add(found.conname)
    if (unique.name && found.conname !== unique.name) {
      problems.push(
        `${table}: unique constraint on (${unique.columns}) is named ${found.conname}, schema says ${unique.name}`,
      )
    }
  }
  return problems
}

function diffForeignKeys(
  config: TableConfig,
  tableConstraints: readonly ConstraintRow[],
  claimed: Set<string>,
): string[] {
  const table = config.name
  const problems: string[] = []
  for (const foreignKey of config.foreignKeys) {
    const reference = foreignKey.reference()
    const columnsOfKey = reference.columns.map((column) => column.name)
    const foreignTable = getTableConfig(reference.foreignTable as PgTable).name
    const foreignColumns = reference.foreignColumns.map((column) => column.name)
    const found = tableConstraints.find(
      (constraint) => constraint.contype === 'f' && same(constraint.columns, columnsOfKey),
    )
    if (!found) {
      problems.push(`${table}: missing foreign key (${columnsOfKey}) -> ${foreignTable}`)
      continue
    }
    claimed.add(found.conname)
    if (found.ref_table !== foreignTable || !same(found.ref_columns ?? [], foreignColumns)) {
      problems.push(
        `${table}: foreign key (${columnsOfKey}) targets ${found.ref_table}(${found.ref_columns}), schema says ${foreignTable}(${foreignColumns})`,
      )
    }
    const onDelete = foreignKey.onDelete ?? 'no action'
    if (found.deltype !== ON_DELETE_CODE[onDelete]) {
      problems.push(
        `${table}: foreign key (${columnsOfKey}) ON DELETE code is ${found.deltype}, schema says ${onDelete}`,
      )
    }
    if (found.conname !== foreignKey.getName()) {
      problems.push(
        `${table}: foreign key (${columnsOfKey}) is named ${found.conname}, schema says ${foreignKey.getName()}`,
      )
    }
  }
  return problems
}

function diffIndexes(config: TableConfig, indexes: readonly IndexRow[]): string[] {
  const table = config.name
  const problems: string[] = []
  const dbIndexes = indexes.filter((row) => row.table_name === table)
  const claimedIndexes = new Set<string>()
  for (const index of config.indexes) {
    const name = index.config.name ?? ''
    const expectedColumns = index.config.columns.map((column) =>
      'name' in column ? (column.name ?? '') : String(column),
    )
    const found = dbIndexes.find((row) => row.index_name === name)
    if (!found) {
      problems.push(`${table}: missing index ${name}`)
      continue
    }
    claimedIndexes.add(name)
    if (!same(found.columns, expectedColumns)) {
      problems.push(
        `${table}.${name}: columns are (${found.columns}), schema says (${expectedColumns})`,
      )
    }
    if (found.is_unique !== Boolean(index.config.unique)) {
      problems.push(
        `${table}.${name}: unique is ${found.is_unique}, schema says ${Boolean(index.config.unique)}`,
      )
    }
    if (found.partial) {
      problems.push(`${table}.${name}: partial index (${found.partial}) is not in the schema`)
    }
  }
  for (const row of dbIndexes) {
    if (!claimedIndexes.has(row.index_name)) {
      problems.push(`database has index ${table}.${row.index_name} the schema does not declare`)
    }
  }
  return problems
}

function diffTable(config: TableConfig, catalog: Catalog, collations: Collations): string[] {
  const tableConstraints = catalog.constraints.filter((row) => row.table_name === config.name)
  const claimed = new Set<string>()
  const problems = [
    ...diffColumns(config, catalog.columns, tableConstraints, claimed, collations),
    ...diffPrimaryKey(config, tableConstraints, claimed),
    ...diffUniques(config, tableConstraints, claimed),
    ...diffForeignKeys(config, tableConstraints, claimed),
  ]
  for (const constraint of tableConstraints) {
    if (!claimed.has(constraint.conname)) {
      problems.push(
        `database has constraint ${config.name}.${constraint.conname} (${constraint.def}) the schema does not declare`,
      )
    }
  }
  return [...problems, ...diffIndexes(config, catalog.indexes)]
}

export async function diffSchemaAgainstDatabase(
  sql: Sql,
  tables: readonly PgTable[],
  options: {
    /** Columns that must carry an explicit collation, as `table.column` -> name. */
    collations?: Collations
    ignoreTables?: readonly string[]
  } = {},
): Promise<string[]> {
  const problems: string[] = []
  const ignore = new Set(options.ignoreTables ?? [])
  const configs = tables.map((table) => getTableConfig(table))
  const wanted = new Set(configs.map((config) => config.name))
  const catalog = await readCatalog(sql)

  const existingTables = new Set(catalog.columns.map((column) => column.table_name))
  for (const name of existingTables) {
    if (!wanted.has(name) && !ignore.has(name)) {
      problems.push(`database has table ${name} the schema does not declare`)
    }
  }
  for (const config of configs) {
    if (existingTables.has(config.name)) {
      problems.push(...diffTable(config, catalog, options.collations ?? {}))
    } else problems.push(`table ${config.name} is missing from the database`)
  }
  return problems
}
