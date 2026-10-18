import { DatabaseSync } from 'node:sqlite'

import { Miniflare } from 'miniflare'
import { describe, expect, it } from 'vitest'

import { sqliteSearchPredicate } from '../runtime/server/sql-search'
import folds from '../runtime/server/unicode-search-folds.json'
import { matchesSearchText, normalizeSearchText } from '../runtime/shared/search-text'

describe('shared SQL word search', () => {
  it('runs the Unicode predicate on the actual workerd D1 binding', async () => {
    const runtime = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-01-01',
      d1Databases: ['DB'],
    })
    try {
      const db = await runtime.getD1Database('DB')
      await db.exec('CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT)')
      await db
        .prepare('INSERT INTO names VALUES (1, ?), (2, ?)')
        .bind('Café École 한국 ΟΣ', 'unrelated')
        .run()
      const { sql, bindings } = sqliteSearchPredicate('name', 'école cafe 한국 ος')
      const result = await db
        .prepare(`SELECT id FROM names WHERE ${sql} ORDER BY id LIMIT 1`)
        .bind(...bindings)
        .all()
      expect(result.results).toEqual([{ id: 1 }])
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps the generated fold lookup equivalent to the runtime Unicode normalizer', () => {
    const expected: Record<string, string> = {}
    for (let point = 128; point <= 0x10ffff; point++) {
      if (point >= 0xac00 && point <= 0xd7a3) continue
      const char = String.fromCodePoint(point)
      if (!/[\p{L}\p{N}\p{M}]/u.test(char)) continue
      const folded = normalizeSearchText(char)
      if (folded !== char) expected[point] = folded
    }
    expect(folds).toEqual(expected)
  })

  it('matches case, accents, decomposed marks and non-Latin names before count and paging', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE names (id INTEGER PRIMARY KEY, text TEXT)')
    const names = [
      'Café café',
      'ÉCOLE éclair',
      'Cafe\u0301 école',
      'ΟΣ Σίσυφος',
      '한국어',
      'Résumé · Straße',
      'İstanbul',
      'Ångström',
      '中文',
      'a\u{1D165}b',
      'tideye-ios',
      'other',
    ]
    for (const [id, text] of names.entries())
      db.prepare('INSERT INTO names VALUES (?,?)').run(id, text)
    for (const needle of [
      'cafe',
      'eclair ÉCOLE',
      'école cafe',
      'ος',
      'ΣΙΣΥΦΟΣ',
      '한국',
      'resume straße',
      'istanbul',
      'angstrom',
      '中文',
      'ab',
      'IOS TIDEYE',
      '% _',
      'missing',
      'cafe '.repeat(110),
    ]) {
      const { sql, bindings } = sqliteSearchPredicate('text', needle)
      const expected = names.flatMap((text, id) => (matchesSearchText(text, needle) ? [id] : []))
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM names WHERE ${sql}`).get(...bindings)?.count,
        needle,
      ).toBe(expected.length)
      const found = []
      for (let offset = 0; offset < expected.length; offset += 2) {
        found.push(
          ...db
            .prepare(`SELECT id FROM names WHERE ${sql} ORDER BY id LIMIT 2 OFFSET ?`)
            .all(...bindings, offset)
            .map((row) => row.id),
        )
      }
      expect(found, needle).toEqual(expected)
    }
    db.close()
  })

  it('binds hostile input as words, never as SQL', () => {
    const db = new DatabaseSync(':memory:')
    const { sql, bindings } = sqliteSearchPredicate("'ordinary'", "' OR 1=1 --")
    expect(db.prepare(`SELECT ${sql} AS matched`).get(...bindings)?.matched).toBe(0)
    expect(bindings).toHaveLength(2)
    db.close()
  })
})
