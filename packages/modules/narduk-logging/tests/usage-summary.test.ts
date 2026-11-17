import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  authorizeUsageSummary,
  buildUsageSummary,
  parseUsageSummaryRange,
  signInsByDay,
  usageDayStart,
  USAGE_SUMMARY_PATH,
  USAGE_SUMMARY_ROW_CAP,
  USAGE_SUMMARY_SCHEMA_VERSION,
} from '../src/usage-summary.js'
import type { D1Like, D1StatementLike } from '../src/usage-summary.js'
import { USAGE_COUNTS_DDL } from '../src/usage.js'
import { BROWSER_ERRORS_DDL } from '../src/client-errors.js'
import { SERVER_ERRORS_DDL } from '../src/server-health.js'

function sqliteD1(raw: DatabaseSync): D1Like {
  const statement = (sql: string, values: unknown[] = []): D1StatementLike => ({
    bind: (...next) => statement(sql, next),
    run: async () => raw.prepare(sql).run(...(values as never[])),
    all: async <T>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
  })
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      for (const s of statements) await s.run()
    },
  }
}

const TOKEN = 'a'.repeat(40)

describe('parseUsageSummaryRange', () => {
  it('defaults to the 30 days ending today', () => {
    expect(parseUsageSummaryRange({}, '2026-11-17')).toEqual({
      since: '2026-10-19',
      until: '2026-11-17',
    })
  })

  it('takes a range of up to 90 days ending no later than today', () => {
    expect(
      parseUsageSummaryRange({ since: '2026-08-20', until: '2026-11-17' }, '2026-11-17'),
    ).toEqual({
      since: '2026-08-20',
      until: '2026-11-17',
    })
    expect(
      parseUsageSummaryRange({ since: '2026-08-19', until: '2026-11-17' }, '2026-11-17'),
    ).toBeNull()
    expect(parseUsageSummaryRange({ until: '2026-11-18' }, '2026-11-17')).toBeNull()
    expect(
      parseUsageSummaryRange({ since: '2026-11-10', until: '2026-11-01' }, '2026-11-17'),
    ).toBeNull()
    expect(parseUsageSummaryRange({ since: 'last week' }, '2026-11-17')).toBeNull()
    expect(parseUsageSummaryRange({ since: '2026-02-31' }, '2026-11-17')).toBeNull()
    // Inside the 90 days, so only the calendar check refuses it (Date would read it as October 1).
    expect(parseUsageSummaryRange({ since: '2026-09-31' }, '2026-11-17')).toBeNull()
    expect(parseUsageSummaryRange({ until: '2026-11-31' }, '2026-12-17')).toBeNull()
  })
})

describe('usageDayStart', () => {
  it('is midnight on the app clock, daylight saving included', () => {
    expect(usageDayStart('2026-11-17').toISOString()).toBe('2026-11-17T00:00:00.000Z')
    expect(usageDayStart('2026-11-17', 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-17T08:00:00.000Z',
    )
    expect(usageDayStart('2026-07-01', 'America/Los_Angeles').toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    )
    // The days the clocks change: midnight is still on the old offset.
    expect(usageDayStart('2026-03-08', 'America/Los_Angeles').toISOString()).toBe(
      '2026-03-08T08:00:00.000Z',
    )
    expect(usageDayStart('2026-11-01', 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-01T07:00:00.000Z',
    )
    expect(usageDayStart('2026-11-17', 'Asia/Tokyo').toISOString()).toBe('2026-11-16T15:00:00.000Z')
  })
})

describe('authorizeUsageSummary', () => {
  it('opens for the app token as a bearer and for nothing else', async () => {
    expect(await authorizeUsageSummary(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(await authorizeUsageSummary(`bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(await authorizeUsageSummary(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
    expect(await authorizeUsageSummary(TOKEN, TOKEN)).toBe(false)
    expect(await authorizeUsageSummary(null, TOKEN)).toBe(false)
  })

  it('answers no one while the app has no real token', async () => {
    expect(await authorizeUsageSummary('Bearer short', 'short')).toBe(false)
    expect(await authorizeUsageSummary('Bearer ', '')).toBe(false)
    expect(await authorizeUsageSummary(`Bearer ${TOKEN}`, undefined)).toBe(false)
  })
})

describe('buildUsageSummary', () => {
  let raw: DatabaseSync
  let db: D1Like

  beforeEach(() => {
    raw = new DatabaseSync(':memory:')
    raw.exec(USAGE_COUNTS_DDL)
    raw.exec(BROWSER_ERRORS_DDL)
    raw.exec(SERVER_ERRORS_DDL)
    db = sqliteD1(raw)
  })

  it('answers counts by day, role and platform, sign-ins and errors by release, and no person', async () => {
    raw.exec(`INSERT INTO usage_counts VALUES
      ('2026-11-17', 'screen', '/orders', 'agent', 'web', 5),
      ('2026-11-17', 'screen', '/orders', 'agent', 'ios', 2),
      ('2026-11-16', 'event', 'order_saved', 'agent', 'web', 3),
      ('2026-10-01', 'screen', '/orders', 'agent', 'web', 99)`)
    raw.exec(`INSERT INTO browser_errors VALUES
      ('h1', 'web', '/orders', 'Dana broke it', 'web 1.2', 'r1', 4, '2026-11-01T00:00:00Z', '2026-11-17T10:00:00Z'),
      ('h2', 'web', '/x', 'other', 'web 1.2', NULL, 1, '2026-11-02T00:00:00Z', '2026-11-16T10:00:00Z'),
      ('h3', 'ios', '/ios/crash', 'Crash', 'ios 1.0.0 (42)', NULL, 2, '2026-11-02T00:00:00Z', '2026-11-15T10:00:00Z'),
      ('h4', 'web', '/old', 'old', 'web 1.0', NULL, 9, '2026-09-02T00:00:00Z', '2026-09-03T10:00:00Z'),
      ('h5', 'web', '/early', 'early', 'web 1.1', NULL, 3, '2026-11-01T00:00:00Z', '2026-11-11T07:59:00.000Z'),
      ('h6', 'web', '/late', 'late', 'web 1.3', NULL, 3, '2026-11-18T08:00:00.000Z', '2026-11-18T08:00:00.000Z')`)
    // Before the 11th and after the 17th on the yard's clock: neither counts.
    raw.exec(`INSERT INTO server_errors VALUES
      ('s1', 'api', 500, 'GET', '/api/x', 'boom', NULL, 6, '2026-11-01T00:00:00Z', '2026-11-17T09:00:00Z'),
      ('s2', 'api', 500, 'GET', '/api/y', 'later', NULL, 4, '2026-11-18T09:00:00Z', '2026-11-18T09:00:00Z')`)
    const summary = await buildUsageSummary(db, {
      app: 'pacc-trac',
      since: '2026-11-11',
      until: '2026-11-17',
      timeZone: 'America/Los_Angeles',
      now: new Date('2026-11-17T20:00:00Z'),
      signIns: async () =>
        signInsByDay(
          [
            { at: '2026-11-17T18:00:00Z', role: 'agent' },
            { at: '2026-11-17T19:00:00Z', role: 'agent' },
            { at: '2026-11-18T02:00:00Z', role: 'pacc_admin' },
            { at: '2026-10-01T02:00:00Z', role: 'agent' },
          ],
          'America/Los_Angeles',
        ),
    })
    expect(summary).toEqual({
      schemaVersion: USAGE_SUMMARY_SCHEMA_VERSION,
      app: 'pacc-trac',
      generatedAt: '2026-11-17T20:00:00.000Z',
      since: '2026-11-11',
      until: '2026-11-17',
      timeZone: 'America/Los_Angeles',
      screens: [
        { day: '2026-11-17', name: '/orders', role: 'agent', platform: 'web', count: 5 },
        { day: '2026-11-17', name: '/orders', role: 'agent', platform: 'ios', count: 2 },
      ],
      events: [
        { day: '2026-11-16', name: 'order_saved', role: 'agent', platform: 'web', count: 3 },
      ],
      // 02:00 UTC on the 18th is the 17th on the yard's clock; October is outside the range.
      signIns: [
        { day: '2026-11-17', role: 'agent', count: 2 },
        { day: '2026-11-17', role: 'pacc_admin', count: 1 },
      ],
      errors: [
        {
          source: 'client',
          release: 'web 1.2',
          errors: 2,
          occurrences: 5,
          lastSeenAt: '2026-11-17T10:00:00Z',
        },
        {
          source: 'client',
          release: 'ios 1.0.0 (42)',
          errors: 1,
          occurrences: 2,
          lastSeenAt: '2026-11-15T10:00:00Z',
        },
        {
          source: 'server',
          release: null,
          errors: 1,
          occurrences: 6,
          lastSeenAt: '2026-11-17T09:00:00Z',
        },
      ],
      truncated: false,
    })
    expect(JSON.stringify(summary)).not.toMatch(/Dana|boom|\/api\/x|r1/)
  })

  it('reads a table the app does not have as empty', async () => {
    const bare = new DatabaseSync(':memory:')
    const summary = await buildUsageSummary(sqliteD1(bare), {
      app: 'blog',
      since: '2026-11-11',
      until: '2026-11-17',
    })
    expect(summary).toMatchObject({
      screens: [],
      events: [],
      signIns: [],
      errors: [],
      timeZone: 'UTC',
      truncated: false,
    })
  })

  it('still throws what is not a missing table', async () => {
    const broken: D1Like = {
      prepare: () => {
        throw new Error('D1_ERROR: network lost')
      },
      batch: async () => [],
    }
    await expect(
      buildUsageSummary(broken, { app: 'x', since: '2026-11-11', until: '2026-11-17' }),
    ).rejects.toThrow(/network lost/)
  })

  it('cuts a list at the row cap and says so', async () => {
    const insert = raw.prepare(
      `INSERT INTO usage_counts VALUES ('2026-11-17', 'screen', ?, 'agent', 'web', 1)`,
    )
    for (let i = 0; i <= USAGE_SUMMARY_ROW_CAP; i++) insert.run(`/s/${i}`)
    const summary = await buildUsageSummary(db, {
      app: 'x',
      since: '2026-11-17',
      until: '2026-11-17',
    })
    expect(summary.screens).toHaveLength(USAGE_SUMMARY_ROW_CAP)
    expect(summary.truncated).toBe(true)
  })

  it('names the route every app answers on', () => {
    expect(USAGE_SUMMARY_PATH).toBe('/api/usage/summary')
  })
})
