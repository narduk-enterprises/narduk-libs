import { describe, expect, it } from 'vitest'

import { findDestructiveStatements } from '../src/migration-compatibility.js'

function kinds(sql: string): string[] {
  return findDestructiveStatements(sql).map((found) => `${found.kind}:${found.object}`)
}

describe('findDestructiveStatements', () => {
  it('passes an expand-only migration', () => {
    expect(
      kinds(`
        CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        ALTER TABLE users ADD COLUMN nickname TEXT;
        CREATE INDEX idx_widgets_name ON widgets(name);
        DROP INDEX IF EXISTS idx_old;
        DROP TRIGGER IF EXISTS trg_old;
        INSERT INTO widgets (name) VALUES ('a');
      `),
    ).toEqual([])
  })

  it('names every drop and rename of a table, view or column', () => {
    expect(
      kinds(`
        DROP TABLE legacy;
        drop table if exists "Quoted Name";
        DROP VIEW v_totals;
        ALTER TABLE users DROP COLUMN nickname;
        ALTER TABLE users DROP legacy_flag;
        ALTER TABLE orders RENAME TO purchases;
        ALTER TABLE items RENAME COLUMN qty TO quantity;
        ALTER TABLE items RENAME sku TO code;
        DROP TABLE main.[bracketed];
        DROP TABLE \`backticked\`;
      `),
    ).toEqual([
      'drop-table:legacy',
      'drop-table:quoted name',
      'drop-view:v_totals',
      'drop-column:users',
      'drop-column:users',
      'rename-table:orders',
      'rename-column:items',
      'rename-column:items',
      'drop-table:bracketed',
      'drop-table:backticked',
    ])
  })

  it('reports the line each statement starts on', () => {
    const sql =
      'CREATE TABLE a (id INTEGER);\n\n-- tidy up\nDROP TABLE b;\nALTER TABLE c\n  DROP COLUMN d;'
    expect(findDestructiveStatements(sql).map((found) => found.line)).toEqual([4, 5])
  })

  it('ignores DDL inside comments and string literals', () => {
    expect(
      kinds(`
        -- DROP TABLE users;
        /* ALTER TABLE users RENAME TO people; */
        INSERT INTO audit (note) VALUES ('DROP TABLE users; it''s gone');
        UPDATE notes SET body = 'ALTER TABLE x DROP COLUMN y';
      `),
    ).toEqual([])
  })

  it('lets a file reshape a table it created itself, and nothing else', () => {
    // SQLite's table rebuild: only dropping the ORIGINAL table is destructive.
    expect(
      kinds(`
        CREATE TABLE users_new (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
        INSERT INTO users_new (id, email) SELECT id, email FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE TABLE scratch (id INTEGER);
        DROP TABLE scratch;
      `),
    ).toEqual(['drop-table:users'])
  })

  it('does not treat CREATE ... IF NOT EXISTS as proof the table is new', () => {
    expect(kinds('CREATE TABLE IF NOT EXISTS sessions (id TEXT);\nDROP TABLE sessions;')).toEqual([
      'drop-table:sessions',
    ])
  })
})
