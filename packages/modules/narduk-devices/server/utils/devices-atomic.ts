import { DevicesError } from './devices-error'

import type { DevicesDatabase } from './devices'
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

interface SynchronousTransactionClient {
  transaction: (callback: () => unknown[]) => () => unknown[]
}

/**
 * Whether this database can run `runDevicesBatch` at all. Used where an atomic
 * grouping is an improvement rather than a requirement (the lockout counter), so
 * a plain query-builder adapter degrades to sequential statements instead of
 * failing an authentication path outright.
 */
export function supportsAtomicBatch(db: DevicesDatabase): boolean {
  const database = db as DevicesDatabase &
    Partial<Pick<DrizzleD1Database, 'batch'>> & {
      $client?: Partial<SynchronousTransactionClient>
    }
  return Boolean(database.batch ?? database.$client?.transaction)
}

/**
 * D1 batches are transactions. The native better-sqlite3 adapter runs the same
 * statements inside its synchronous transaction for local tests/consumers.
 * No sequential, non-transactional fallback is safe for claim completion: a
 * half-applied completion would leave a consumed token with no device.
 *
 * Same contract as narduk-tenancy's `runTenancyBatch`.
 */
export async function runDevicesBatch<
  T extends [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>],
>(db: DevicesDatabase, statements: T): Promise<BatchResponse<T>> {
  const database = db as DevicesDatabase &
    Partial<Pick<DrizzleD1Database, 'batch'>> & {
      $client?: Partial<SynchronousTransactionClient>
    }
  if (database.batch) return database.batch(statements)

  const client = database.$client
  if (!client?.transaction) {
    throw new DevicesError(
      'invalid',
      'Atomic device operations require a D1 or better-sqlite3 database.',
    )
  }
  const results = client.transaction(() =>
    statements.map((statement) => {
      // Drizzle's common RunnableQuery type omits the SQLite driver's all().
      const result = (statement as unknown as { all: () => unknown }).all()
      if (result instanceof Promise) {
        throw new DevicesError(
          'invalid',
          'A synchronous SQLite transaction cannot run async statements.',
        )
      }
      return result
    }),
  )()
  return results as BatchResponse<T>
}
