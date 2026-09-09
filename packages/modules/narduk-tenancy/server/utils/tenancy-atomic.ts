import { sql } from 'drizzle-orm'

import { roleRank, TENANCY_ROLES } from '../../shared/utils/roles'
import { tenancyMemberships } from '../database/tenancy-schema'

import { TenancyError } from './tenancy-error'

import type { TenancyDatabase } from './tenancy'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

/** The owner count is evaluated in the mutation, never in an earlier read. */
export function preservesAnOwner(orgId: string, userId: string): SQL {
  return sql`(${tenancyMemberships.role} <> 'owner' OR EXISTS (
    SELECT 1 FROM tenancy_memberships AS remaining_owner
    WHERE remaining_owner.org_id = ${orgId}
      AND remaining_owner.role = 'owner'
      AND remaining_owner.user_id <> ${userId}
  ))`
}

/** SQL counterpart of roleRank, derived from the same role vocabulary. */
export function sqlRoleRank(role: SQLWrapper): SQL<number> {
  return sql<number>`CASE ${role} ${sql.join(
    TENANCY_ROLES.map((value) => sql`WHEN ${value} THEN ${roleRank(value)}`),
    sql` `,
  )} ELSE 0 END`
}

interface SynchronousTransactionClient {
  transaction: (callback: () => unknown[]) => () => unknown[]
}

/**
 * D1 batches are transactions. The native better-sqlite3 adapter uses the same
 * statements inside its synchronous transaction for local tests/consumers.
 * No sequential, non-transactional fallback is safe for invitation claims.
 */
export async function runTenancyBatch<
  T extends [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>],
>(db: TenancyDatabase, statements: T): Promise<BatchResponse<T>> {
  const database = db as TenancyDatabase &
    Partial<Pick<DrizzleD1Database, 'batch'>> & {
      $client?: Partial<SynchronousTransactionClient>
    }
  if (database.batch) return database.batch(statements)

  const client = database.$client
  if (!client?.transaction) {
    throw new TenancyError(
      'invalid',
      'Atomic tenancy operations require a D1 or better-sqlite3 database.',
    )
  }
  const results = client.transaction(() =>
    statements.map((statement) => {
      // Drizzle's common RunnableQuery type omits the SQLite driver's all().
      const result = (statement as unknown as { all: () => unknown }).all()
      if (result instanceof Promise) {
        throw new TenancyError(
          'invalid',
          'A synchronous SQLite transaction cannot run async statements.',
        )
      }
      return result
    }),
  )()
  return results as BatchResponse<T>
}
