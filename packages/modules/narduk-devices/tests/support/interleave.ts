import type { DevicesDatabase } from '../../server/utils/devices'

/**
 * Drizzle exposes the compiled statement, which is what lets a gate name the
 * write it waits on instead of counting anonymous calls.
 */
interface CompilableStatement {
  toSQL: () => { sql: string }
}

/** The synchronous better-sqlite3 client `runDevicesBatch` falls back to. */
interface TransactionClient {
  transaction: <T>(fn: () => T) => () => T
}

export interface InterleaveOptions {
  /**
   * Runs once, while the matched write is held open. Whatever it does has
   * already landed by the time the gated caller's own statements execute.
   */
  sneak: () => Promise<unknown>
  /**
   * Which write to hold, matched against the compiled SQL of the batch's first
   * statement. The first batch that matches is gated; every other batch, and
   * every later one, runs untouched.
   */
  whenWriting: (sql: string) => boolean
}

/**
 * A database that holds one atomic write open until another caller has
 * finished its own.
 *
 * `runDevicesBatch` prefers a `batch` method and otherwise falls back to one
 * better-sqlite3 transaction, so supplying `batch` puts an await point at the
 * exact moment a caller commits -- after it has read the state it is acting
 * on, before any of its statements run. A second caller released there has
 * necessarily read the same state, which is the interleaving `Promise.all`
 * leaves to the scheduler and therefore does not reliably produce
 * (narduk-libs#445).
 *
 * The statements still execute inside one transaction, so the atomicity the
 * gated write is being tested for is the real one.
 */
export function interleaveAtWrite(
  db: DevicesDatabase,
  options: InterleaveOptions,
): DevicesDatabase {
  let gated = false
  const client = (db as DevicesDatabase & { $client?: Partial<TransactionClient> }).$client
  if (!client?.transaction) {
    throw new Error('interleaveAtWrite needs a better-sqlite3 database to run the batch itself.')
  }
  // Bound, not extracted: better-sqlite3's `transaction` reads private state
  // off its own Database instance, so calling a detached reference throws.
  const transacting: TransactionClient = client as TransactionClient
  // One documented cast, the same one `withStaleReads` makes: the wrapper adds
  // the one method `runDevicesBatch` looks for and inherits everything else.
  const wrapper = Object.create(db) as Record<string, unknown>
  wrapper.batch = async (statements: readonly CompilableStatement[]) => {
    const first = statements.at(0)
    if (!gated && first !== undefined && options.whenWriting(first.toSQL().sql)) {
      gated = true
      await options.sneak()
    }
    return transacting.transaction(() =>
      statements.map((statement) => (statement as unknown as { all: () => unknown }).all()),
    )()
  }
  return wrapper as DevicesDatabase
}

/** The re-issue single-writer lock: statement one of the re-issue batch. */
export const REISSUE_LOCK_WRITE = (sql: string): boolean =>
  sql.includes('insert into "devices_scoped_nonces"')

/** The claim completion that creates the device: statement one of that batch. */
export const DEVICE_CREATE_WRITE = (sql: string): boolean =>
  sql.includes('insert into "devices_devices"')
