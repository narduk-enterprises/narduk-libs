import { describe, expect, it, vi } from 'vitest'

import { runAtomicBatch } from '../runtime/server/utils/atomic-batch'

import type { BatchItem } from 'drizzle-orm/batch'

type Statements = [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>]

function statement(all: () => unknown) {
  return { all } as unknown as BatchItem<'sqlite'>
}

/** A better-sqlite3-shaped client: `transaction(fn)` returns a runner that rolls back on a throw. */
function sqliteClient() {
  const committed: unknown[][] = []
  const client = {
    transaction: vi.fn((callback: () => unknown[]) => () => {
      const results = callback()
      committed.push(results)
      return results
    }),
  }
  return { client, committed }
}

describe('runAtomicBatch (narduk-libs#201)', () => {
  it('hands the statements to D1 batch() unchanged', async () => {
    const batch = vi.fn(async (items: unknown[]) => items.map((_, index) => [{ index }]))
    const statements = [statement(() => []), statement(() => [])] as Statements

    const results = await runAtomicBatch({ batch }, statements)

    expect(batch).toHaveBeenCalledWith(statements)
    expect(results).toEqual([[{ index: 0 }], [{ index: 1 }]])
  })

  it('runs every statement inside one better-sqlite3 transaction, in order', async () => {
    const { client, committed } = sqliteClient()
    const order: string[] = []
    const statements = [
      statement(() => (order.push('insert'), [{ id: 1 }])),
      statement(() => (order.push('upsert'), [{ id: 2 }])),
    ] as Statements

    const results = await runAtomicBatch({ $client: client }, statements)

    expect(client.transaction).toHaveBeenCalledOnce()
    expect(order).toEqual(['insert', 'upsert'])
    expect(results).toEqual([[{ id: 1 }], [{ id: 2 }]])
    expect(committed).toEqual([results])
  })

  it('commits nothing when a statement throws inside the transaction', async () => {
    const { client, committed } = sqliteClient()
    const statements = [
      statement(() => [{ id: 1 }]),
      statement(() => {
        throw new TypeError('This statement does not return data')
      }),
    ] as Statements

    await expect(runAtomicBatch({ $client: client }, statements)).rejects.toThrow(
      'does not return data',
    )
    expect(committed).toEqual([])
  })

  it('refuses an async statement under the synchronous driver', async () => {
    const { client, committed } = sqliteClient()
    const statements = [statement(async () => [])] as Statements

    await expect(runAtomicBatch({ $client: client }, statements)).rejects.toThrow(
      'cannot run async statements',
    )
    expect(committed).toEqual([])
  })

  it('refuses a database with neither batch() nor a transaction client', async () => {
    const all = vi.fn(() => [])
    await expect(runAtomicBatch({}, [statement(all)] as Statements)).rejects.toThrow(
      'D1 or better-sqlite3',
    )
    expect(all).not.toHaveBeenCalled()
  })
})
