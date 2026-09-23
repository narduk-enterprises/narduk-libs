import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

interface SynchronousTransactionClient {
  transaction: (callback: () => unknown[]) => () => unknown[]
}

type AtomicBatchDatabase = object &
  Partial<Pick<DrizzleD1Database, 'batch'>> & {
    $client?: Partial<SynchronousTransactionClient>
  }

/**
 * Run `statements` as one transaction on either driver an app's database runs
 * on, so the same code works in the Worker and under vitest against the merged
 * migrations (narduk-libs#201):
 *
 * - D1 (`drizzle-orm/d1`): `db.batch(statements)`, which D1 runs as a
 *   transaction.
 * - better-sqlite3 (`drizzle-orm/better-sqlite3`): every statement's `.all()`
 *   inside `db.$client.transaction`.
 *
 * The sharp edge is the synchronous driver: there every statement must return
 * rows, so give writes a `.returning(...)`, or better-sqlite3 throws "This
 * statement does not return data". Any other database is refused rather than
 * run statement by statement, because a half-applied batch is the failure this
 * exists to prevent.
 */
export async function runAtomicBatch<
  T extends [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>],
>(db: object, statements: T): Promise<BatchResponse<T>> {
  const database = db as AtomicBatchDatabase
  if (database.batch) return database.batch(statements)

  const client = database.$client
  if (!client?.transaction) {
    throw new Error('runAtomicBatch needs a D1 or better-sqlite3 drizzle database.')
  }
  const results = client.transaction(() =>
    statements.map((statement) => {
      // Drizzle's common RunnableQuery type omits the SQLite driver's all().
      const result = (statement as unknown as { all: () => unknown }).all()
      if (result instanceof Promise) {
        throw new TypeError('A synchronous SQLite transaction cannot run async statements.')
      }
      return result
    }),
  )()
  return results as BatchResponse<T>
}
