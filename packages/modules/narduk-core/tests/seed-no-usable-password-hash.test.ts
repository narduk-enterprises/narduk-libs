/**
 * No SQL file this package publishes may carry a usable password hash. The
 * package ships `runtime/`, so a seed row with a real `salt:hash` string would
 * reach every app that installs the layer. Seeded users get `password_hash`
 * NULL; an app that needs a local login sets one at seed time through
 * `hashUserPassword()`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const RUNTIME_DIR = fileURLToPath(new URL('../runtime', import.meta.url))

// The shape `hashUserPassword()` returns: a 16-byte salt, a colon, a 256-bit key.
const HASH_SHAPE = /\b[0-9a-f]{32}:[0-9a-f]{64}\b/iu

function sqlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sqlFiles(path)
    return entry.name.endsWith('.sql') ? [path] : []
  })
}

/** Walk `text`, calling `visit` for each character outside a string literal. */
function scan(text: string, visit: (char: string, index: number) => void): void {
  let inString = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (char === "'") {
      if (inString && text[index + 1] === "'") index++
      else inString = !inString
    } else if (!inString) visit(char, index)
  }
}

/** Split on `separator` outside string literals and parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  scan(text, (char, index) => {
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === separator && depth === 0) {
      parts.push(text.slice(from, index))
      from = index + 1
    }
  })
  parts.push(text.slice(from))
  return parts.map((part) => part.trim())
}

/** The bodies of the parenthesised tuples in `text`, outside string literals. */
function tuples(text: string): string[] {
  const bodies: string[] = []
  let depth = 0
  let from = 0
  scan(text, (char, index) => {
    if (char === '(') {
      if (depth === 0) from = index + 1
      depth++
    } else if (char === ')') {
      depth--
      if (depth === 0) bodies.push(text.slice(from, index))
    }
  })
  return bodies
}

/** The value after `password_hash =`: a quoted string or a bare token. */
function assignedValues(statement: string): string[] {
  const values: string[] = []
  for (const match of statement.matchAll(/password_hash[`"\]]?\s*=\s*/giu)) {
    const rest = statement.slice(match.index + match[0].length)
    if (rest.startsWith("'")) {
      let end = 1
      while (end < rest.length && (rest[end] !== "'" || rest[end + 1] === "'")) {
        end += rest[end] === "'" ? 2 : 1
      }
      values.push(rest.slice(0, end + 1))
    } else values.push(rest.split(/[\s,;]/u, 1)[0]!)
  }
  return values
}

/** Every term bound to a `password_hash` column by an INSERT or SET in `sql`. */
function passwordHashTerms(sql: string): string[] {
  const terms: string[] = []
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  for (const statement of splitTopLevel(withoutComments, ';')) {
    const valuesAt = statement.search(/\bVALUES\b/iu)
    if (/^INSERT\b/iu.test(statement) && valuesAt !== -1) {
      const columns = (tuples(statement.slice(0, valuesAt))[0] ?? '')
        .split(',')
        .map((column) => column.trim().replaceAll(/[`"[\]]/gu, ''))
      const at = columns.indexOf('password_hash')
      const conflictAt = statement.search(/\bON\s+CONFLICT\b/iu)
      const rows = statement.slice(valuesAt, conflictAt === -1 ? undefined : conflictAt)
      if (at !== -1) for (const row of tuples(rows)) terms.push(splitTopLevel(row, ',')[at] ?? '')
      if (conflictAt !== -1) terms.push(...assignedValues(statement.slice(conflictAt)))
    } else terms.push(...assignedValues(statement))
  }

  return terms.filter((term) => !/^excluded\.password_hash$/iu.test(term))
}

describe('published SQL carries no usable password hash', () => {
  const files = sqlFiles(RUNTIME_DIR)

  it('finds the seed file', () => {
    expect(files.some((file) => file.endsWith('seed.sql'))).toBe(true)
  })

  it.each(files.map((file) => [file.slice(RUNTIME_DIR.length + 1), file]))(
    '%s binds password_hash to NULL only',
    (_name, file) => {
      const sql = readFileSync(file, 'utf8')
      expect(sql).not.toMatch(HASH_SHAPE)
      for (const term of passwordHashTerms(sql)) expect(term).toMatch(/^NULL$/iu)
    },
  )

  it('detects a hash in an INSERT row, an UPDATE and a bare hash string', () => {
    const hash = `${'ab'.repeat(16)}:${'cd'.repeat(32)}`
    const insert = `INSERT INTO users (id, email, password_hash, name)\nVALUES\n  ('1', 'a@b.c', '${hash}', 'A'),\n  ('2', 'd@e.f', NULL, 'B');`
    expect(passwordHashTerms(insert)).toEqual([`'${hash}'`, 'NULL'])
    expect(passwordHashTerms(`UPDATE users SET password_hash = '${hash}' WHERE id = '1';`)).toEqual(
      [`'${hash}'`],
    )
    expect(HASH_SHAPE.test(`-- ${hash}`)).toBe(true)
    expect(
      passwordHashTerms(
        `INSERT INTO users (id, password_hash) VALUES ('1', NULL) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash;`,
      ),
    ).toEqual(['NULL'])
  })
})
