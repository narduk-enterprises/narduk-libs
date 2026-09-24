/**
 * The `--json` reply `wrangler d1 execute --command` gives, over a node:sqlite
 * database: ONE result set per statement, in order. Wrangler's local path
 * splits the command and runs it as one `db.batch`, so a multi-statement read
 * gets one entry each -- the shape `parseWranglerBatchJson` requires
 * (narduk-libs#704). A fake that ran only the first statement would let the
 * batched inspection read the wrong result as the wrong table.
 */

import type { DatabaseSync } from 'node:sqlite'

/** Split on `;` outside quotes, brackets and comments; drop empty statements. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    if (char === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2)
      index = end === -1 ? sql.length : end + 2
      continue
    }
    const close = char === '[' ? ']' : char === "'" || char === '"' || char === '`' ? char : null
    if (close) {
      const end = sql.indexOf(close, index + 1)
      const stop = end === -1 ? sql.length : end + 1
      current += sql.slice(index, stop)
      index = stop
      continue
    }
    if (char === ';') {
      if (current.trim()) statements.push(`${current.trim()};`)
      current = ''
    } else {
      current += char
    }
    index += 1
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

export function wranglerJson(db: DatabaseSync, command: string): string {
  const statements = splitStatements(command)
  db.exec('BEGIN;')
  try {
    const entries = statements.map((sql) => ({ success: true, results: db.prepare(sql).all() }))
    db.exec('COMMIT;')
    return JSON.stringify(entries)
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }
}
