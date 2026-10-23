/**
 * A static lint for D1/SQLite migration files, run from a plain Vitest test or a
 * CI script. Pure: it reads files and never needs Miniflare, a database or a
 * browser.
 *
 * Two rules, both about decisions that are expensive to reverse once a column
 * holds production rows:
 *
 *   - `money-real-column`: a money-named column declared with a binary float
 *     or an inexact numeric type. SQLite stores `NUMERIC`/`DECIMAL` with REAL
 *     affinity as soon as a value has a fractional part, so only INTEGER minor
 *     units are exact. Rates such as `price_per_kg` are deliberately NOT
 *     matched: only the whole name or its final `_` token is compared.
 *   - `destructive-statement`: `DROP TABLE`, `ALTER TABLE ... DROP COLUMN` and
 *     `ALTER TABLE ... RENAME`. D1 migrations run unattended before a deploy, so
 *     these need a person to have looked. A drizzle table rebuild
 *     (`DROP TABLE x` then `ALTER TABLE x_next RENAME TO x`) fires both, which
 *     is the intended behaviour.
 *
 * LIMITS. Statements come from `splitSqlStatements`, which strips comments and
 * splits on `;` without parsing SQL. A trigger body (`BEGIN ... END`) is cut
 * into fragments that no rule matches, and a `--` or `;` inside a string
 * literal truncates or splits the statement. Neither can create a finding; both
 * can hide one.
 *
 * ALLOWANCES are a ledger that only shrinks, like the accessibility baseline: an
 * entry that matches nothing is itself a finding, so it cannot outlive the
 * statement it excused.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { splitSqlStatements } from './d1.js'

export type MigrationRuleId = 'money-real-column' | 'destructive-statement'

export interface MigrationLintFinding {
  /** The file as the caller named it (a basename for `lintMigrationsDir`). */
  file: string
  /** Position among the file's statements, 0-based. -1 for `stale-allowance`. */
  statementIndex: number
  id: MigrationRuleId | 'stale-allowance'
  message: string
  /** The statement with whitespace normalised; empty for `stale-allowance`. */
  statement: string
  /** `hashMigrationStatement(statement)`, ready to paste into an allowance. */
  statementHash: string
}

export interface MigrationAllowance {
  /** Basename of the migration file. */
  file: string
  id: MigrationRuleId
  /**
   * Pins the allowance to one statement. Without it every `id` finding in the
   * file is allowed, including ones added later; with it an edited statement
   * fails again.
   */
  statementHash?: string
  /** Why the finding is acceptable. Required: an unexplained allowance is a mute button. */
  reason: string
}

export interface MigrationLintOptions {
  allow?: readonly MigrationAllowance[]
  /** Replaces `DEFAULT_MONEY_NAMES`. Lowercase; compared to the whole name or its final `_` token. */
  moneyNames?: readonly string[]
  /** Replaces `DEFAULT_INEXACT_NUMERIC_TYPES`. Uppercase; compared to the first word of the type. */
  inexactTypes?: readonly string[]
}

export const DEFAULT_MONEY_NAMES: readonly string[] = [
  'price',
  'amount',
  'cost',
  'total',
  'fee',
  'balance',
  'subtotal',
  'tax',
  'discount',
  'usd',
  'eur',
  'gbp',
]

export const DEFAULT_INEXACT_NUMERIC_TYPES: readonly string[] = [
  'REAL',
  'FLOAT',
  'DOUBLE',
  'NUMERIC',
  'DECIMAL',
]

type TokenKind = 'word' | 'quoted' | 'string' | 'number' | 'punct'

interface Token {
  kind: TokenKind
  /** Identifier text for words and quoted names; raw text otherwise. */
  value: string
}

function tokenize(statement: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < statement.length) {
    const char = statement[index] as string
    if (/\s/u.test(char)) {
      index += 1
      continue
    }
    const closer = char === '[' ? ']' : char === '"' || char === '`' || char === "'" ? char : null
    if (closer) {
      let end = index + 1
      let value = ''
      while (end < statement.length) {
        // A doubled quote is an escaped quote inside a quoted name or string.
        if (statement[end] === closer && statement[end + 1] === closer && closer !== ']') {
          value += closer
          end += 2
          continue
        }
        if (statement[end] === closer) break
        value += statement[end]
        end += 1
      }
      tokens.push({ kind: char === "'" ? 'string' : 'quoted', value })
      index = end + 1
      continue
    }
    const word = /^[A-Za-z_][\w$]*/u.exec(statement.slice(index))
    if (word) {
      tokens.push({ kind: 'word', value: word[0] })
      index += word[0].length
      continue
    }
    const number = /^\d[\d.]*/u.exec(statement.slice(index))
    if (number) {
      tokens.push({ kind: 'number', value: number[0] })
      index += number[0].length
      continue
    }
    tokens.push({ kind: 'punct', value: char })
    index += 1
  }
  return tokens
}

const isWord = (token: Token | undefined, ...words: string[]) =>
  token?.kind === 'word' && words.includes(token.value.toUpperCase())

const isName = (token: Token | undefined) => token?.kind === 'word' || token?.kind === 'quoted'

/** Keywords that start a table constraint rather than a column definition. */
const TABLE_CONSTRAINT_WORDS = ['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK']

/** Keywords that end the declared type of a column and start its constraints. */
const COLUMN_CONSTRAINT_WORDS = [
  'CONSTRAINT',
  'PRIMARY',
  'NOT',
  'NULL',
  'UNIQUE',
  'CHECK',
  'DEFAULT',
  'COLLATE',
  'REFERENCES',
  'GENERATED',
  'AS',
]

/**
 * Collapse whitespace outside quotes so a reformatted statement keeps its
 * identity. Case and quoted text are preserved: `"old  records"` is another table.
 */
export function normalizeMigrationStatement(statement: string): string {
  let out = ''
  let closer: string | null = null
  let space = false
  for (const char of statement) {
    if (closer) {
      out += char
      if (char === closer) closer = null
      continue
    }
    if (/\s/u.test(char)) {
      space = true
      continue
    }
    if (space && out) out += ' '
    space = false
    out += char
    closer = char === '[' ? ']' : char === '"' || char === '`' || char === "'" ? char : null
  }
  return out
}

/** sha256 of the normalised statement: the pin an allowance's `statementHash` holds. */
export function hashMigrationStatement(statement: string): string {
  return createHash('sha256').update(normalizeMigrationStatement(statement)).digest('hex')
}

/**
 * Whether a column name reads as money: the whole name, or its final `_` token,
 * is in the list. `amount_kg` and `price_per_kg_units` do not match; `amount`,
 * `line_total` and `fob_usd` do.
 */
export function isMoneyLikeColumnName(
  name: string,
  moneyNames: readonly string[] = DEFAULT_MONEY_NAMES,
): boolean {
  const lower = name.toLowerCase()
  const finalToken = lower.slice(lower.lastIndexOf('_') + 1)
  return moneyNames.includes(lower) || moneyNames.includes(finalToken)
}

interface RawFinding {
  id: MigrationRuleId
  message: string
}

/** The declared type of a column definition: the words before its first constraint. */
function declaredTypeWords(definition: Token[]): string[] {
  const words: string[] = []
  for (const token of definition.slice(1)) {
    if (token.kind === 'word' && COLUMN_CONSTRAINT_WORDS.includes(token.value.toUpperCase())) break
    if (token.kind === 'punct' && token.value === '(') break
    if (token.kind === 'word') words.push(token.value.toUpperCase())
  }
  return words
}

function checkColumn(
  table: string,
  definition: Token[],
  options: Required<Pick<MigrationLintOptions, 'moneyNames' | 'inexactTypes'>>,
): RawFinding | null {
  const name = definition[0]
  if (!isName(name)) return null
  if (isWord(name, ...TABLE_CONSTRAINT_WORDS)) return null
  const typeWords = declaredTypeWords(definition)
  const firstWord = typeWords[0]
  if (!firstWord || !options.inexactTypes.includes(firstWord)) return null
  if (!isMoneyLikeColumnName((name as Token).value, options.moneyNames)) return null
  return {
    id: 'money-real-column',
    message:
      `${table}.${(name as Token).value} is money-like but declared ${typeWords.join(' ')}. ` +
      'Store money as INTEGER minor units (cents); a binary float cannot hold 0.10 exactly.',
  }
}

/** Split tokens on commas that are not inside parentheses. */
function splitTopLevel(tokens: Token[]): Token[][] {
  const segments: Token[][] = [[]]
  let depth = 0
  for (const token of tokens) {
    if (token.kind === 'punct' && token.value === '(') depth += 1
    if (token.kind === 'punct' && token.value === ')') depth -= 1
    if (token.kind === 'punct' && token.value === ',' && depth === 0) {
      segments.push([])
      continue
    }
    segments.at(-1)?.push(token)
  }
  return segments.filter((segment) => segment.length > 0)
}

/** Read `name` or `schema.name` at `start`; returns the name and the next index. */
function readTableName(tokens: Token[], start: number): { name: string; next: number } | null {
  const first = tokens[start]
  if (!isName(first)) return null
  const second = tokens[start + 2]
  if (tokens[start + 1]?.value === '.' && isName(second)) {
    return { name: (second as Token).value, next: start + 3 }
  }
  return { name: (first as Token).value, next: start + 1 }
}

function lintStatement(
  statement: string,
  options: Required<Pick<MigrationLintOptions, 'moneyNames' | 'inexactTypes'>>,
): RawFinding[] {
  const tokens = tokenize(statement)
  const findings: RawFinding[] = []
  let cursor = 0

  if (isWord(tokens[0], 'CREATE')) {
    cursor = 1
    if (isWord(tokens[cursor], 'TEMP', 'TEMPORARY')) cursor += 1
    if (!isWord(tokens[cursor], 'TABLE')) return findings
    cursor += 1
    if (isWord(tokens[cursor], 'IF')) cursor += 3
    const table = readTableName(tokens, cursor)
    if (!table || tokens[table.next]?.value !== '(') return findings
    const body = tokens.slice(table.next + 1)
    // Drop the closing parenthesis; table options such as WITHOUT ROWID follow it.
    let depth = 1
    let end = 0
    for (; end < body.length; end += 1) {
      // Only punctuation nests: a `')'` default or a `")"` column name is not a bracket.
      if (body[end]?.kind === 'punct' && body[end]?.value === '(') depth += 1
      if (body[end]?.kind === 'punct' && body[end]?.value === ')') depth -= 1
      if (depth === 0) break
    }
    for (const definition of splitTopLevel(body.slice(0, end))) {
      const finding = checkColumn(table.name, definition, options)
      if (finding) findings.push(finding)
    }
    return findings
  }

  if (isWord(tokens[0], 'DROP') && isWord(tokens[1], 'TABLE')) {
    cursor = 2
    if (isWord(tokens[cursor], 'IF')) cursor += 2
    const table = readTableName(tokens, cursor)
    findings.push({
      id: 'destructive-statement',
      message: `DROP TABLE ${table?.name ?? '?'} deletes the table and its rows.`,
    })
    return findings
  }

  if (isWord(tokens[0], 'ALTER') && isWord(tokens[1], 'TABLE')) {
    const table = readTableName(tokens, 2)
    if (!table) return findings
    const action = tokens[table.next]
    const rest = tokens.slice(table.next + 1)
    if (isWord(action, 'ADD')) {
      const definition = isWord(rest[0], 'COLUMN') ? rest.slice(1) : rest
      const finding = checkColumn(table.name, definition, options)
      if (finding) findings.push(finding)
    } else if (isWord(action, 'DROP')) {
      const column = isWord(rest[0], 'COLUMN') ? rest[1] : rest[0]
      findings.push({
        id: 'destructive-statement',
        message: `ALTER TABLE ${table.name} DROP COLUMN ${column?.value ?? '?'} deletes the column's data.`,
      })
    } else if (isWord(action, 'RENAME')) {
      findings.push({
        id: 'destructive-statement',
        message:
          `ALTER TABLE ${table.name} RENAME breaks every query, view and trigger that ` +
          'still uses the old name.',
      })
    }
  }
  return findings
}

function resolveOptions(options: MigrationLintOptions) {
  return {
    inexactTypes: options.inexactTypes ?? DEFAULT_INEXACT_NUMERIC_TYPES,
    moneyNames: options.moneyNames ?? DEFAULT_MONEY_NAMES,
  }
}

function validateAllowances(allow: readonly MigrationAllowance[]) {
  for (const entry of allow) {
    if (!entry.reason.trim()) {
      throw new Error(
        `Migration allowance for ${entry.file} (${entry.id}) needs a reason; an unexplained allowance is a mute button.`,
      )
    }
  }
}

function allowanceMatches(entry: MigrationAllowance, finding: MigrationLintFinding) {
  return (
    entry.file === basename(finding.file) &&
    entry.id === finding.id &&
    (entry.statementHash === undefined || entry.statementHash === finding.statementHash)
  )
}

function findingsForFile(sql: string, file: string, options: MigrationLintOptions) {
  const resolved = resolveOptions(options)
  const findings: MigrationLintFinding[] = []
  for (const [statementIndex, rawStatement] of splitSqlStatements(sql).entries()) {
    const statement = normalizeMigrationStatement(rawStatement)
    const statementHash = hashMigrationStatement(statement)
    for (const raw of lintStatement(statement, resolved)) {
      findings.push({
        file,
        id: raw.id,
        message: raw.message,
        statement,
        statementHash,
        statementIndex,
      })
    }
  }
  return findings
}

/**
 * Lint one file's SQL. Allowances for this `file` are applied; stale-allowance
 * reporting needs the whole directory and lives in `lintMigrationsDir`.
 */
export function lintMigrationSql(
  sql: string,
  options: MigrationLintOptions & { file: string },
): MigrationLintFinding[] {
  const allow = options.allow ?? []
  validateAllowances(allow)
  return findingsForFile(sql, options.file, options).filter(
    (finding) => !allow.some((entry) => allowanceMatches(entry, finding)),
  )
}

/** The files D1's own discovery applies: numbered `.sql` files, lexical order. */
function migrationFiles(dir: string): string[] {
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory.`)
  return readdirSync(dir)
    .filter((entry) => /^\d/u.test(entry) && entry.endsWith('.sql'))
    .sort()
}

/**
 * Lint every numbered `.sql` file in a directory and report allowances that
 * matched nothing as `stale-allowance` findings (`statementIndex` -1), including
 * an allowance naming a file the directory does not contain.
 */
export function lintMigrationsDir(
  dir: string,
  options: MigrationLintOptions = {},
): MigrationLintFinding[] {
  const allow = options.allow ?? []
  validateAllowances(allow)
  const used = new Set<MigrationAllowance>()
  const findings: MigrationLintFinding[] = []
  const files = migrationFiles(dir)

  for (const file of files) {
    const fileFindings = findingsForFile(readFileSync(join(dir, file), 'utf8'), file, options)
    for (const finding of fileFindings) {
      const matching = allow.filter((entry) => allowanceMatches(entry, finding))
      for (const entry of matching) used.add(entry)
      if (matching.length === 0) findings.push(finding)
    }
  }

  for (const entry of allow) {
    if (used.has(entry)) continue
    const reason = files.includes(entry.file)
      ? `matches no ${entry.id} finding${entry.statementHash ? ' with that statement hash' : ''}`
      : 'names a file that is not in the migrations directory'
    findings.push({
      file: entry.file,
      id: 'stale-allowance',
      message: `Allowance (${entry.id}) ${reason}; remove it so it cannot excuse a later change.`,
      statement: '',
      statementHash: entry.statementHash ?? '',
      statementIndex: -1,
    })
  }
  return findings
}

export function formatMigrationFinding(finding: MigrationLintFinding): string {
  const where =
    finding.statementIndex >= 0 ? `${finding.file} #${finding.statementIndex}` : finding.file
  const pin = finding.statementHash ? ` [statementHash ${finding.statementHash}]` : ''
  return `${where} ${finding.id}: ${finding.message}${pin}`
}

/** Throw one error listing every finding, so a run shows the whole backlog at once. */
export function assertMigrationsClean(dir: string, options: MigrationLintOptions = {}): void {
  const findings = lintMigrationsDir(dir, options)
  if (findings.length === 0) return
  throw new Error(
    `${findings.length} migration lint finding(s) in ${dir}:\n` +
      findings.map(formatMigrationFinding).join('\n'),
  )
}
