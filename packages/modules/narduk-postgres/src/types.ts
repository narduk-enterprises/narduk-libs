/**
 * The driver seam.
 *
 * This package never imports `postgres`, `pg`, or any other driver. A consumer
 * hands in something that can run a parameterized statement, and everything
 * here -- health, migrations, the SQL builders in `@narduk-enterprises/narduk-
 * timeseries` -- is written against that interface. Three things fall out of
 * that: a Worker bundle carries only the driver it actually chose, the unit
 * tests run against a protocol fake with no database anywhere, and swapping
 * postgres.js for node-postgres is a consumer edit rather than a library
 * release.
 */

export interface QueryResult<Row> {
  rows: Row[]
  /** Rows returned, or rows affected for a statement that returns none. */
  rowCount: number
}

export interface SqlExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>
}

export interface TransactionalExecutor extends SqlExecutor {
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>
}

export function isTransactionalExecutor(executor: SqlExecutor): executor is TransactionalExecutor {
  return typeof (executor as Partial<TransactionalExecutor>).transaction === 'function'
}

/**
 * A connection whose lifetime the caller owns. Every factory in this package
 * returns one of these rather than a long-lived client, because on Workers a
 * client that outlives the invocation is a leaked socket (see `./worker`).
 */
export interface ManagedConnection extends SqlExecutor {
  end(): Promise<void> | void
}

export type ConnectionFactory<Options> = (
  connectionString: string,
  options: Options,
) => ManagedConnection | Promise<ManagedConnection>
