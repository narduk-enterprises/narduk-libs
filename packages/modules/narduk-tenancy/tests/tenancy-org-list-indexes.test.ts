/**
 * Migration 0002: the indexes that keep the two org-console list reads
 * proportional to the page a consumer asks for and to the invitations that are
 * still live, rather than to everything the org has ever accumulated
 * (narduk-libs#229).
 *
 * These are deliberately not this package's own queries -- narduk-tenancy
 * ships no paged member or invite list. It owns the schema, so it owns the
 * schema's indexes, and the three query shapes below are the consumer's,
 * quoted from the issue.
 *
 * Neither read was a full table scan before 0002: `tenancy_memberships(org_id,
 * user_id)` and `tenancy_invites(org_id, email)` already narrow to one org, so
 * a `SCAN` assertion would have been green before the change and proves
 * nothing. What 0002 changes is what happens *inside* the org, which this file
 * measures two ways:
 *
 *   - the plan SQLite picks, which names the index and the constraints it
 *     pushes into the seek; and
 *   - rows visited, counted exactly by a SQL function the query calls once per
 *     row that reaches it, over two scale axes moved independently.
 *
 * Nothing here measures latency. Miniflare and better-sqlite3 both run on the
 * test machine with no network hop and none of production's load, so their
 * timings would mean nothing; the claim being proven is the scaling shape.
 */
import { readFileSync } from 'node:fs'

import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createD1QueryHarness, splitSqlStatements } from '../../../tooling/narduk-testkit/src/d1'

import { MIGRATION_DIR, MIGRATION_PATHS } from './support/database'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'

const MIGRATION_0002 = MIGRATION_PATHS.find((path) => path.endsWith('0002_org_list_indexes.sql'))
const BEFORE_0002 = MIGRATION_PATHS.filter((path) => !path.endsWith('0002_org_list_indexes.sql'))

/** One page of an org's members, ordered by the `(created_at, id)` cursor a consumer pages with. */
const MEMBER_PAGE = `SELECT id, user_id, role, created_at FROM tenancy_memberships
  WHERE org_id = ? ORDER BY created_at, user_id LIMIT 200`

/** One page of the org's invitations, the same ordered, paged shape. */
const INVITE_PAGE = `SELECT id, email, role, created_at FROM tenancy_invites
  WHERE org_id = ? ORDER BY created_at, id LIMIT 200`

/** The org's live invitations: not accepted, not revoked, not expired. */
const PENDING_INVITES = `SELECT id, email, role, created_at FROM tenancy_invites
  WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`

/** The badge count beside that list, issued on every org-home load. */
const PENDING_INVITE_COUNT = `SELECT count(*) AS live FROM tenancy_invites
  WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`

const NOW = 1_700_000_000_000

/**
 * The same queries with one extra term, `visit(id) = 1`, placed immediately
 * after `org_id = ?`: after the constraint an index can push into the seek,
 * before the three an index either pushes into the seek or leaves SQLite to
 * test row by row. The function is registered non-deterministic, so SQLite
 * calls it once per row that reaches that point and cannot cache or hoist it.
 *
 * Each probed query's plan is asserted equal to its unprobed original's, so
 * the count below is a count of what the shipped query does, not of a
 * different query that happens to resemble it.
 */
const PROBE = ' AND visit(id) = 1'
const probed = {
  invitePage: INVITE_PAGE.replace('WHERE org_id = ?', `WHERE org_id = ?${PROBE}`),
  memberPage: MEMBER_PAGE.replace('WHERE org_id = ?', `WHERE org_id = ?${PROBE}`),
  pendingInvites: PENDING_INVITES.replace('WHERE org_id = ?', `WHERE org_id = ?${PROBE}`),
  pendingInviteCount: PENDING_INVITE_COUNT.replace('WHERE org_id = ?', `WHERE org_id = ?${PROBE}`),
}

interface Sqlite {
  close: () => void
  /** Run `sql` and return the rows it produced and the rows it visited getting there. */
  measure: (sql: string, params: readonly unknown[]) => { rows: unknown[]; visits: number }
  plan: (sql: string, params: readonly unknown[]) => string[]
  seed: (options: { dead?: number; live?: number; members?: number }) => void
}

function openSqlite(migrations: readonly string[]): Sqlite {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const path of migrations) db.exec(readFileSync(path, 'utf8'))

  let visits = 0
  db.function('visit', { deterministic: false }, (_id: unknown) => {
    visits += 1
    return 1
  })

  return {
    close: () => {
      db.close()
    },
    plan: (sql, params) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map(
        (row) => row.detail,
      ),
    measure: (sql, params) => {
      visits = 0
      const rows = db.prepare(sql).all(...params) as unknown[]
      return { rows, visits }
    },
    seed: ({ dead = 0, live = 0, members = 0 }) => {
      const org = db.prepare(
        'INSERT INTO tenancy_orgs (id, slug, name, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      const member = db.prepare(
        'INSERT INTO tenancy_memberships (id, org_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      const invite = db.prepare(
        'INSERT INTO tenancy_invites (id, org_id, email, role, token_hash, invited_by_user_id, expires_at, accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      db.transaction(() => {
        // Two orgs, seeded identically: every count below is an assertion that
        // the read stayed inside the org it asked for.
        for (const id of ['org-a', 'org-b']) {
          org.run(id, id, id, 'seed', NOW, NOW)
          for (let k = 0; k < members; k += 1) {
            member.run(`${id}-m${k}`, id, `user-${k}`, 'crew', NOW + k, NOW)
          }
          for (let k = 0; k < live; k += 1) {
            invite.run(
              `${id}-l${k}`,
              id,
              `l${k}@e.test`,
              'crew',
              `${id}-lh${k}`,
              'inviter',
              NOW + 9_000_000,
              null,
              NOW + k,
            )
          }
          // Retained history: invitations already accepted, which the live
          // list must never return and should not have to look at.
          for (let k = 0; k < dead; k += 1) {
            invite.run(
              `${id}-d${k}`,
              id,
              `d${k}@e.test`,
              'crew',
              `${id}-dh${k}`,
              'inviter',
              NOW + 9_000_000,
              NOW,
              NOW + k,
            )
          }
        }
      })()
    },
  }
}

function seeded(migrations: readonly string[], options: Parameters<Sqlite['seed']>[0]): Sqlite {
  const db = openSqlite(migrations)
  db.seed(options)
  return db
}

describe('0002_org_list_indexes', () => {
  let current: D1QueryHarness
  let previous: D1QueryHarness

  beforeAll(async () => {
    current = await createD1QueryHarness({ migrations: MIGRATION_DIR })
    previous = await createD1QueryHarness({ migrations: BEFORE_0002 })
  })

  afterAll(async () => {
    await current.dispose()
    await previous.dispose()
  })

  it('applies after every earlier tenancy migration and creates all three indexes', async () => {
    // Read the names out of the shipped migration rather than restating them,
    // so a renamed or dropped index fails here instead of quietly passing a
    // list this file also owns.
    const declared = [
      ...readFileSync(MIGRATION_0002 ?? '', 'utf8').matchAll(
        /CREATE INDEX IF NOT EXISTS (\w+)\s+ON (\w+)/gu,
      ),
    ].map((match) => ({ name: match[1] ?? '', tbl_name: match[2] ?? '' }))

    expect(declared).toEqual([
      { name: 'tenancy_memberships_org_created_at_idx', tbl_name: 'tenancy_memberships' },
      { name: 'tenancy_invites_org_created_at_idx', tbl_name: 'tenancy_invites' },
      { name: 'tenancy_invites_org_pending_idx', tbl_name: 'tenancy_invites' },
    ])

    const found = await current.raw
      .prepare(
        `SELECT tbl_name, name FROM sqlite_master WHERE type = 'index' AND name IN (${declared.map(() => '?').join(', ')}) ORDER BY name`,
      )
      .bind(...declared.map((index) => index.name))
      .all<{ name: string; tbl_name: string }>()

    expect(found.results).toEqual([...declared].sort((a, b) => (a.name < b.name ? -1 : 1)))
  })

  it('re-applies without error (IF NOT EXISTS)', async () => {
    expect(MIGRATION_0002).toBeDefined()
    const statements = splitSqlStatements(readFileSync(MIGRATION_0002 ?? '', 'utf8'))
    expect(statements).toHaveLength(3)
    await current.raw.batch(statements.map((statement) => current.raw.prepare(statement)))
  })

  describe('the plan the real D1 driver picks', () => {
    it('reads a member page in `created_at` order from the index', async () => {
      const plan = await current.raw
        .prepare(`EXPLAIN QUERY PLAN ${MEMBER_PAGE}`)
        .bind('org-a')
        .all<{ detail: string }>()
      const detail = plan.results.map((row) => row.detail).join('\n')

      expect(detail).toMatch(
        /SEARCH tenancy_memberships USING INDEX tenancy_memberships_org_created_at_idx \(org_id=\?\)/u,
      )
      // The index supplies `created_at` order, so the only sort left is within
      // a run of rows sharing one `created_at` -- bounded by the tie, not by
      // the org.
      expect(detail).toContain('USE TEMP B-TREE FOR LAST TERM OF ORDER BY')
    })

    it('reads an invite page in `created_at` order from the index', async () => {
      const plan = await current.raw
        .prepare(`EXPLAIN QUERY PLAN ${INVITE_PAGE}`)
        .bind('org-a')
        .all<{ detail: string }>()
      const detail = plan.results.map((row) => row.detail).join('\n')

      expect(detail).toMatch(
        /SEARCH tenancy_invites USING INDEX tenancy_invites_org_created_at_idx \(org_id=\?\)/u,
      )
      expect(detail).toContain('USE TEMP B-TREE FOR LAST TERM OF ORDER BY')
    })

    it('narrows the pending-invite predicate inside the index, not row by row', async () => {
      for (const sql of [PENDING_INVITES, PENDING_INVITE_COUNT]) {
        const plan = await current.raw
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind('org-a', NOW)
          .all<{ detail: string }>()

        expect(plan.results.map((row) => row.detail).join('\n')).toMatch(
          /SEARCH tenancy_invites USING (?:COVERING )?INDEX tenancy_invites_org_pending_idx \(org_id=\? AND accepted_at=\? AND revoked_at=\? AND expires_at>\?\)/u,
        )
      }
    })

    it('did neither before 0002 (control: these assertions can fail)', async () => {
      const member = await previous.raw
        .prepare(`EXPLAIN QUERY PLAN ${MEMBER_PAGE}`)
        .bind('org-a')
        .all<{ detail: string }>()
      const memberDetail = member.results.map((row) => row.detail).join('\n')
      // The whole org's memberships go through a sort, on every page.
      expect(memberDetail).toContain('USE TEMP B-TREE FOR ORDER BY')
      expect(memberDetail).not.toContain('LAST TERM OF ORDER BY')

      const invitePage = await previous.raw
        .prepare(`EXPLAIN QUERY PLAN ${INVITE_PAGE}`)
        .bind('org-a')
        .all<{ detail: string }>()
      const invitePageDetail = invitePage.results.map((row) => row.detail).join('\n')
      // Same as the member page: the org's whole invite history is sorted to
      // return one page of it.
      expect(invitePageDetail).toContain('USE TEMP B-TREE FOR ORDER BY')
      expect(invitePageDetail).not.toContain('LAST TERM OF ORDER BY')

      const invites = await previous.raw
        .prepare(`EXPLAIN QUERY PLAN ${PENDING_INVITES}`)
        .bind('org-a', NOW)
        .all<{ detail: string }>()
      // Only `org_id` reaches the index; the three predicate columns are left
      // for SQLite to test on every invite the org has ever issued.
      expect(invites.results.map((row) => row.detail).join('\n')).toMatch(
        /SEARCH tenancy_invites USING INDEX tenancy_invites_org_email_idx \(org_id=\?\)$/u,
      )
    })
  })

  describe('rows visited', () => {
    it('measures the shipped queries: each probed plan matches its original', () => {
      const db = seeded(MIGRATION_PATHS, { dead: 4, live: 2, members: 4 })
      try {
        const pairs = [
          [MEMBER_PAGE, probed.memberPage, ['org-a']],
          [INVITE_PAGE, probed.invitePage, ['org-a']],
          [PENDING_INVITES, probed.pendingInvites, ['org-a', NOW]],
          [PENDING_INVITE_COUNT, probed.pendingInviteCount, ['org-a', NOW]],
        ] as const

        for (const [original, withProbe, params] of pairs) {
          // `count(*)` reads no column, so the unprobed count can use the
          // index alone; asking for `id` is what makes it visit the row.
          expect(
            db.plan(withProbe, params).join('\n').replaceAll('COVERING INDEX', 'INDEX'),
          ).toEqual(db.plan(original, params).join('\n').replaceAll('COVERING INDEX', 'INDEX'))
        }
      } finally {
        db.close()
      }
    })

    it('holds a member page to the page, not to the org (axis: org size)', () => {
      const visits = { after: [] as number[], before: [] as number[] }
      for (const members of [200, 1000, 5000]) {
        for (const [key, migrations] of [
          ['before', BEFORE_0002],
          ['after', MIGRATION_PATHS],
        ] as const) {
          const db = seeded(migrations, { members })
          try {
            const measured = db.measure(probed.memberPage, ['org-a'])
            expect(measured.rows).toHaveLength(200)
            visits[key].push(measured.visits)
          } finally {
            db.close()
          }
        }
      }

      // Before: every membership in the org is read and sorted to return 200.
      expect(visits.before).toEqual([200, 1000, 5000])
      // After: the page, plus the one row that proves the 200th `created_at`
      // had no tie. Flat as the org grows 25x.
      expect(visits.after).toEqual([200, 201, 201])
    })

    it('holds an invite page to the page, not to the org (axis: org size)', () => {
      const visits = { after: [] as number[], before: [] as number[] }
      for (const live of [200, 1000, 5000]) {
        for (const [key, migrations] of [
          ['before', BEFORE_0002],
          ['after', MIGRATION_PATHS],
        ] as const) {
          const db = seeded(migrations, { live })
          try {
            const measured = db.measure(probed.invitePage, ['org-a'])
            expect(measured.rows).toHaveLength(200)
            visits[key].push(measured.visits)
          } finally {
            db.close()
          }
        }
      }

      expect(visits.before).toEqual([200, 1000, 5000])
      expect(visits.after).toEqual([200, 201, 201])
    })

    it('holds the live-invite reads to the live invitations (axis: retained history)', () => {
      const visits = { after: [] as number[], before: [] as number[] }
      for (const dead of [0, 50, 500]) {
        for (const [key, migrations] of [
          ['before', BEFORE_0002],
          ['after', MIGRATION_PATHS],
        ] as const) {
          const db = seeded(migrations, { dead, live: 5 })
          try {
            const list = db.measure(probed.pendingInvites, ['org-a', NOW])
            const count = db.measure(probed.pendingInviteCount, ['org-a', NOW])
            // Correctness parity: the same five invitations either way.
            expect(list.rows).toHaveLength(5)
            expect(count.rows).toEqual([{ live: 5 }])
            expect(count.visits).toBe(list.visits)
            visits[key].push(list.visits)
          } finally {
            db.close()
          }
        }
      }

      // Before: five live invitations cost five, fifty-five, five hundred and
      // five reads -- the org's accepted invitations, forever.
      expect(visits.before).toEqual([5, 55, 505])
      // After: flat. Accepted invitations are behind a different index prefix.
      expect(visits.after).toEqual([5, 5, 5])
    })

    it('still scales with the live invitations themselves (axis: live cardinality)', () => {
      const visits = { after: [] as number[], before: [] as number[] }
      for (const live of [1, 5, 25]) {
        for (const [key, migrations] of [
          ['before', BEFORE_0002],
          ['after', MIGRATION_PATHS],
        ] as const) {
          const db = seeded(migrations, { dead: 50, live })
          try {
            const measured = db.measure(probed.pendingInvites, ['org-a', NOW])
            expect(measured.rows).toHaveLength(live)
            visits[key].push(measured.visits)
          } finally {
            db.close()
          }
        }
      }

      // Before: the fifty accepted invitations are paid for every time.
      expect(visits.before).toEqual([51, 55, 75])
      // After: exactly the live set. The index bounds work to what is
      // returned, and a bigger live set is real work, not waste.
      expect(visits.after).toEqual([1, 5, 25])
    })
  })
})
