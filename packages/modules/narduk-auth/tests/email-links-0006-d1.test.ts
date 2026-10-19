import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createD1QueryHarness,
  type D1QueryHarness,
  splitSqlStatements,
} from '../../../tooling/narduk-testkit/src/d1'

/**
 * drizzle/0006 rebuilds auth_email_links on D1 to widen its purpose CHECK
 * (narduk-libs#1952): SQLite cannot alter a CHECK. Prove the rebuild keeps
 * every row and index and enforces the new CHECK, on real D1.
 */

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url))

describe('drizzle/0006 on D1', () => {
  let harness: D1QueryHarness

  beforeAll(async () => {
    harness = await createD1QueryHarness({
      migrations: [
        file('../../narduk-core/runtime/drizzle/0000_initial_schema.sql'),
        file('../drizzle/0001_auth_bridge.sql'),
        file('../drizzle/0002_local_email_auth.sql'),
      ],
    })
  }, 60_000)

  afterAll(async () => {
    await harness?.dispose()
  })

  it('keeps outstanding and spent links, their indexes, and refuses unknown purposes', async () => {
    const { raw } = harness
    await raw
      .prepare(
        `INSERT INTO auth_email_links (id, email, purpose, token_hash, redirect_path, expires_at, consumed_at, created_at)
         VALUES ('l1', 'a@example.com', 'reset', 'h1', '/x', 2000000000, NULL, '2026-10-01T00:00:00.000Z'),
                ('l2', 'b@example.com', 'setup', 'h2', '/y', 1, '2026-10-01T00:05:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run()
    await expect(
      raw
        .prepare(
          "INSERT INTO auth_email_links (id, email, purpose, token_hash, redirect_path, expires_at) VALUES ('l0', 'c@example.com', 'signin', 'h0', '/', 1)",
        )
        .run(),
    ).rejects.toThrow(/CHECK/u)

    const migration = splitSqlStatements(
      readFileSync(file('../drizzle/0006_identities_and_signin_links.sql'), 'utf8'),
    )
    await raw.batch(migration.map((statement) => raw.prepare(statement)))

    const rows = await raw
      .prepare('SELECT * FROM auth_email_links ORDER BY id')
      .all<Record<string, unknown>>()
    expect(rows.results).toEqual([
      {
        id: 'l1',
        email: 'a@example.com',
        purpose: 'reset',
        token_hash: 'h1',
        redirect_path: '/x',
        expires_at: 2000000000,
        consumed_at: null,
        created_at: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'l2',
        email: 'b@example.com',
        purpose: 'setup',
        token_hash: 'h2',
        redirect_path: '/y',
        expires_at: 1,
        consumed_at: '2026-10-01T00:05:00.000Z',
        created_at: '2026-10-01T00:00:00.000Z',
      },
    ])
    const indexes = await raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'auth_email_links' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all<{ name: string }>()
    expect(indexes.results.map((row) => row.name)).toEqual([
      'auth_email_links_email_idx',
      'auth_email_links_expires_at_idx',
    ])
    expect(
      (
        await raw
          .prepare("SELECT name FROM sqlite_master WHERE name = 'auth_email_links_0006'")
          .all()
      ).results,
    ).toEqual([])

    await raw
      .prepare(
        "INSERT INTO auth_email_links (id, email, purpose, token_hash, redirect_path, expires_at) VALUES ('l3', 'c@example.com', 'signin', 'h3', '/', 1)",
      )
      .run()
    await expect(
      raw
        .prepare(
          "INSERT INTO auth_email_links (id, email, purpose, token_hash, redirect_path, expires_at) VALUES ('l4', 'd@example.com', 'bogus', 'h4', '/', 1)",
        )
        .run(),
    ).rejects.toThrow(/CHECK/u)
    await expect(
      raw
        .prepare(
          "INSERT INTO auth_email_links (id, email, purpose, token_hash, redirect_path, expires_at) VALUES ('l5', 'e@example.com', 'signin', 'h3', '/', 1)",
        )
        .run(),
    ).rejects.toThrow(/UNIQUE/u)
  })

  it('creates auth_identities: one account per subject, one account per user and provider', async () => {
    const { raw } = harness
    await raw
      .prepare(
        "INSERT INTO users (id, email, created_at, updated_at) VALUES ('u1', 'u1@example.com', 'x', 'x')",
      )
      .run()
    await raw
      .prepare(
        "INSERT INTO users (id, email, created_at, updated_at) VALUES ('u2', 'u2@example.com', 'x', 'x')",
      )
      .run()
    const insert = (id: string, subject: string, user: string, provider = 'google') =>
      raw
        .prepare(
          `INSERT INTO auth_identities (id, provider, subject, user_id) VALUES ('${id}', '${provider}', '${subject}', '${user}')`,
        )
        .run()
    await insert('i1', 's1', 'u1')
    await expect(insert('i2', 's1', 'u2')).rejects.toThrow(/UNIQUE/u)
    await expect(insert('i3', 's2', 'u1')).rejects.toThrow(/UNIQUE/u)
    await expect(insert('i4', 's3', 'u2', 'github')).rejects.toThrow(/CHECK/u)
    await expect(insert('i5', 's4', 'nobody')).rejects.toThrow(/FOREIGN KEY/u)
    await raw.prepare("DELETE FROM users WHERE id = 'u1'").run()
    expect((await raw.prepare('SELECT * FROM auth_identities').all()).results).toEqual([])
  })
})
