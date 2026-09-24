import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createD1QueryHarness,
  expectQueryPlan,
  expectStatementBudget,
  scaleMatrix,
  splitSqlStatements,
} from '../src/d1.js'

import type { D1QueryHarness } from '../src/d1.js'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/d1-migrations')

async function seed(harness: D1QueryHarness, owners: number, eventsPerOwner: number, live = 1) {
  const { raw } = harness
  await raw.batch(
    Array.from({ length: owners }, (_row, index) =>
      raw
        .prepare('INSERT INTO owners (id, name) VALUES (?, ?)')
        .bind(`o-${index}`, `Owner ${index}`),
    ),
  )
  const events = Array.from({ length: owners * eventsPerOwner }, (_row, index) =>
    raw
      .prepare('INSERT INTO events (owner_id, live, label) VALUES (?, ?, ?)')
      .bind(`o-${index % owners}`, live, `event ${index}`),
  )
  if (events.length > 0) await raw.batch(events)
}

describe('splitSqlStatements', () => {
  it('strips line and block comments before splitting on ;', () => {
    expect(
      splitSqlStatements('-- a; comment\nCREATE TABLE a (x);\n/* b; */ CREATE INDEX i ON a (x);\n'),
    ).toEqual(['CREATE TABLE a (x)', 'CREATE INDEX i ON a (x)'])
  })
})

describe('createD1QueryHarness', () => {
  let harness: D1QueryHarness

  beforeAll(async () => {
    harness = await createD1QueryHarness({ migrations: MIGRATIONS })
  })

  afterAll(async () => {
    await harness.dispose()
  })

  beforeEach(async () => {
    await harness.clearData()
    harness.reset()
  })

  it('applies the numbered migrations in a directory and skips utility SQL', async () => {
    const indexes = await harness.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .bind('events_owner_live_idx')
      .all()
    expect(indexes.results).toHaveLength(1)

    // seed.sql inserts an owner; a fresh harness from the same directory has none.
    const fresh = await createD1QueryHarness({ migrations: MIGRATIONS })
    try {
      const owners = await fresh.raw
        .prepare('SELECT count(*) AS n FROM owners')
        .first<{ n: number }>()
      expect(owners?.n).toBe(0)
    } finally {
      await fresh.dispose()
    }
  })

  it('accepts an explicit list of migration files', async () => {
    const partial = await createD1QueryHarness({
      migrations: [join(MIGRATIONS, '0000_owners.sql')],
    })
    try {
      const indexes = await partial.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .bind('events_owner_live_idx')
        .all()
      expect(indexes.results).toHaveLength(0)
    } finally {
      await partial.dispose()
    }
  })

  it('records statements prepared on db, not on raw, and reset() empties the same array', async () => {
    const held = harness.statements
    await harness.raw.prepare('SELECT 1').all()
    expect(held).toEqual([])

    await harness.db.prepare('SELECT count(*) FROM owners').all()
    await harness.db.batch([harness.db.prepare('SELECT 2'), harness.db.prepare('SELECT 3')])
    expect(held).toEqual(['SELECT count(*) FROM owners', 'SELECT 2', 'SELECT 3'])

    harness.reset()
    expect(harness.statements).toBe(held)
    expect(held).toEqual([])
  })

  it('clearData() empties every table, child rows before parents, and keeps the schema', async () => {
    await seed(harness, 3, 2)
    await harness.clearData()

    const counts = await harness.raw.batch([
      harness.raw.prepare('SELECT count(*) AS n FROM owners'),
      harness.raw.prepare('SELECT count(*) AS n FROM events'),
    ])
    expect(counts.map((result) => (result.results[0] as { n: number }).n)).toEqual([0, 0])
    await seed(harness, 1, 1)
  })

  it('expectStatementBudget passes within budget and returns the result and statements', async () => {
    await seed(harness, 2, 1)
    const { result, statements } = await expectStatementBudget(
      harness,
      async () => (await harness.db.prepare('SELECT id FROM owners ORDER BY id').all()).results,
      { max: 1 },
    )
    expect(result).toEqual([{ id: 'o-0' }, { id: 'o-1' }])
    expect(statements).toEqual(['SELECT id FROM owners ORDER BY id'])
  })

  it('expectStatementBudget fails, listing the statements, when fn prepares more than max', async () => {
    await seed(harness, 3, 0)
    await expect(
      expectStatementBudget(
        harness,
        async () => {
          for (const id of ['o-0', 'o-1', 'o-2']) {
            await harness.db.prepare('SELECT name FROM owners WHERE id = ?').bind(id).first()
          }
        },
        { max: 1 },
      ),
    ).rejects.toThrow(/3 statements, max 1[\s\S]*3\. SELECT name FROM owners WHERE id = \?/u)
  })

  it('expectQueryPlan accepts an index SEARCH and returns the plan', async () => {
    const plan = await expectQueryPlan(
      harness,
      'SELECT label FROM events WHERE owner_id = ? AND live = 1',
      ['o-0'],
      { forbidFullScanOf: ['events'] },
    )
    expect(plan.join('\n')).toMatch(/SEARCH events USING INDEX events_owner_live_idx/u)
  })

  it('expectQueryPlan fails on a full SCAN of a named table and ignores unnamed ones', async () => {
    await expect(
      expectQueryPlan(harness, 'SELECT id FROM events WHERE label = ?', ['x'], {
        forbidFullScanOf: ['events'],
      }),
    ).rejects.toThrow(/Query plan scans SCAN events/u)

    await expect(
      expectQueryPlan(harness, 'SELECT id FROM events WHERE label = ?', ['x'], {
        forbidFullScanOf: ['owners'],
      }),
    ).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/^SCAN events/u)]))
  })

  it('scaleMatrix returns per-cell statements, bytes and results when the count holds', async () => {
    const cells = await scaleMatrix(harness, {
      axes: { history: [0, 50], live: [1, 5] },
      seed: async ({ history, live }) => {
        await seed(harness, live, 1, 1)
        // History: rows for the same owners the live query must skip.
        if (history > 0) {
          await harness.raw.batch(
            Array.from({ length: history }, (_row, index) =>
              harness.raw
                .prepare('INSERT INTO events (owner_id, live, label) VALUES (?, 0, ?)')
                .bind(`o-${index % live}`, `old ${index}`),
            ),
          )
        }
      },
      run: async () =>
        (
          await harness.db
            .prepare(
              'SELECT owners.id, events.label FROM owners JOIN events ON events.owner_id = owners.id AND events.live = 1 ORDER BY owners.id',
            )
            .all()
        ).results,
    })

    expect(cells.map(({ history, live, statements }) => [history, live, statements])).toEqual([
      [0, 1, 1],
      [0, 5, 1],
      [50, 1, 1],
      [50, 5, 1],
    ])
    // Result parity across history, and the byte count is the JSON size.
    expect(cells[2]?.result).toEqual(cells[0]?.result)
    expect(cells[3]?.result).toEqual(cells[1]?.result)
    expect(cells[0]?.bytes).toBe(Buffer.byteLength(JSON.stringify(cells[0]?.result)))
    expect(Math.max(...cells.map((cell) => cell.bytes))).toBeLessThan(400)
  })

  it('scaleMatrix fails when the statement count grows with an axis (N+1)', async () => {
    await expect(
      scaleMatrix(harness, {
        axes: { history: [0], live: [1, 3] },
        seed: ({ live }) => seed(harness, live, 1),
        run: async () => {
          const owners = await harness.db.prepare('SELECT id FROM owners').all<{ id: string }>()
          for (const owner of owners.results) {
            await harness.db
              .prepare('SELECT label FROM events WHERE owner_id = ?')
              .bind(owner.id)
              .all()
          }
        },
      }),
    ).rejects.toThrow(
      /varies across the scale matrix[\s\S]*live=1: 2 statements[\s\S]*live=3: 4 statements/u,
    )
  })
})
