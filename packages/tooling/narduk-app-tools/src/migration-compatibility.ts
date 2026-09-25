/**
 * The expand-only migration rule (narduk-libs#399, deployment-standard design
 * §8): a migration may add tables, columns and indexes, but never drop or rename
 * what the currently serving Worker -- or the version a rollback would restore --
 * still reads. `narduk-app deploy rollback` rolls back code, never a schema, so
 * it is only safe beside migrations that keep the previous code working.
 *
 * This is a statement classifier, not a SQL parser. It strips comments and
 * string literals, splits on `;`, and names every statement that removes or
 * renames a schema object:
 *
 * - `DROP TABLE` / `DROP VIEW`;
 * - `ALTER TABLE ... DROP [COLUMN]`;
 * - `ALTER TABLE ... RENAME TO` and `ALTER TABLE ... RENAME [COLUMN] ... TO`;
 *
 * except on an object the same file created first: the scratch table of a
 * rebuild never existed for the old code.
 *
 * `DROP INDEX` and `DROP TRIGGER` are not flagged: the previous code still runs
 * without them. What it cannot see is stated rather than implied: a data
 * rewrite (`UPDATE`, `DELETE`) the old code misreads, or a new `NOT NULL`
 * constraint the old code's inserts violate, passes this classifier.
 */

export type DestructiveKind =
  'drop-table' | 'drop-view' | 'drop-column' | 'rename-table' | 'rename-column'

export interface DestructiveStatement {
  kind: DestructiveKind
  /** The table or view the statement removes or renames, unquoted, lowercased. */
  object: string
  /** 1-based line the statement starts on. */
  line: number
  /** The statement, whitespace-collapsed and cut to a readable length. */
  statement: string
}

interface Statement {
  text: string
  line: number
}

/**
 * Blanks out comments and string literals (keeping newlines, so line numbers
 * survive) and splits what is left on `;`.
 */
function splitStatements(sql: string): Statement[] {
  let out = ''
  let index = 0
  while (index < sql.length) {
    const char = sql[index]
    const next = sql[index + 1]
    if (char === '-' && next === '-') {
      while (index < sql.length && sql[index] !== '\n') {
        out += ' '
        index += 1
      }
      continue
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2)
      const stop = end === -1 ? sql.length : end + 2
      for (; index < stop; index += 1) out += sql[index] === '\n' ? '\n' : ' '
      continue
    }
    if (char === "'") {
      // A string literal ('' escapes a quote). Its content is data, never DDL.
      out += ' '
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          out += '  '
          index += 2
          continue
        }
        if (sql[index] === "'") {
          out += ' '
          index += 1
          break
        }
        out += sql[index] === '\n' ? '\n' : ' '
        index += 1
      }
      continue
    }
    out += char
    index += 1
  }

  const statements: Statement[] = []
  let line = 1
  let start = 0
  let startLine = 1
  const flush = (end: number): void => {
    const raw = out.slice(start, end)
    const leading = raw.length - raw.trimStart().length
    const offset = raw.slice(0, leading).split('\n').length - 1
    const text = raw.trim()
    if (text.length > 0) statements.push({ text, line: startLine + offset })
  }
  for (let position = 0; position < out.length; position += 1) {
    const char = out[position]
    if (char === ';') {
      flush(position)
      start = position + 1
      startLine = line
    } else if (char === '\n') {
      line += 1
    }
  }
  // The last statement needs no terminating semicolon.
  flush(out.length)
  return statements
}

/** One identifier: "quoted", `quoted`, [quoted] or bare, optionally schema-qualified. */
// Every pattern below is case-insensitive, so the bare form needs only a-z.
const IDENTIFIER = String.raw`"(?:[^"]|"")+"|\x60[^\x60]+\x60|\[[^\]]+\]|[a-z_][\w$]*`
const QUALIFIED = String.raw`(?:(?:${IDENTIFIER})\s*\.\s*)?(${IDENTIFIER})`

const DROP_OBJECT = new RegExp(
  String.raw`^DROP\s+(TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?${QUALIFIED}`,
  'iu',
)
const ALTER_TABLE = new RegExp(String.raw`^ALTER\s+TABLE\s+${QUALIFIED}\s+(\S.*)$`, 'isu')
const RENAME_TABLE_TO = new RegExp(String.raw`^RENAME\s+TO\s+${QUALIFIED}`, 'iu')
// `IF NOT EXISTS` is left out on purpose: that object may well have existed
// before this file, so dropping it later is not the file's own business.
const CREATE_OBJECT = new RegExp(
  String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW)\s+(?!IF\s+NOT\s+EXISTS\b)${QUALIFIED}`,
  'iu',
)

function unquote(identifier: string): string {
  const trimmed = identifier.trim()
  const first = trimmed[0]
  const inner =
    first === '"' || first === '`' || first === '['
      ? trimmed.slice(1, -1).replaceAll('""', '"')
      : trimmed
  return inner.toLowerCase()
}

function excerpt(text: string): string {
  const collapsed = text.replaceAll(/\s+/gu, ' ')
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed
}

/** Every statement in `sql` that drops or renames a table, view or column. */
export function findDestructiveStatements(sql: string): DestructiveStatement[] {
  const created = new Set<string>()
  const found: DestructiveStatement[] = []
  for (const { text, line } of splitStatements(sql)) {
    const create = CREATE_OBJECT.exec(text)
    if (create) {
      created.add(unquote(create[1]))
      continue
    }
    const drop = DROP_OBJECT.exec(text)
    if (drop) {
      const object = unquote(drop[2])
      if (created.has(object)) continue
      const kind: DestructiveKind = drop[1].toUpperCase() === 'VIEW' ? 'drop-view' : 'drop-table'
      found.push({ kind, object, line, statement: excerpt(text) })
      continue
    }
    const alter = ALTER_TABLE.exec(text)
    if (!alter) continue
    const object = unquote(alter[1])
    const action = alter[2]
    // A name a rename moves a table to is this file's own, like a CREATE:
    // no code before this file reads it, so dropping it later breaks nothing
    // (the 12-step rebuild that renames the old table out of the way, #876).
    const renamedTo = RENAME_TABLE_TO.exec(action)
    if (renamedTo) created.add(unquote(renamedTo[1]))
    // Reshaping a table this file created is the file's own business.
    if (created.has(object)) continue
    // SQLite accepts `DROP [COLUMN] name`. `DROP CONSTRAINT` is not SQLite, and it
    // drops no column, so it is not reported as one.
    if (/^DROP\s+(?!CONSTRAINT\b)/iu.test(action)) {
      found.push({ kind: 'drop-column', object, line, statement: excerpt(text) })
    } else if (/^RENAME\s+TO\b/iu.test(action)) {
      found.push({ kind: 'rename-table', object, line, statement: excerpt(text) })
    } else if (/^RENAME\b/iu.test(action)) {
      found.push({ kind: 'rename-column', object, line, statement: excerpt(text) })
    }
  }
  return found
}
