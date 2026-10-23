import type { TenancyDatabase } from '../../server/utils/tenancy'

type Callable = (...args: unknown[]) => unknown

const TERMINALS = new Set<PropertyKey>(['all', 'get', 'run'])

/**
 * `db`, except that the first `write` — `delete`, `insert` or `update` —
 * against `table` runs `sneak` just before it executes: after the service has
 * read everything it checks, and before its own write lands. That is the
 * interleaving a concurrent request produces, made deterministic, and it works
 * the same on better-sqlite3 and on D1 because it sits on the drizzle builder
 * rather than on either driver.
 *
 * A write sent inside a `runTenancyBatch` is gated the same way: the sneak
 * runs before the batch, whose statements then execute in one transaction.
 */
export function interleaveBeforeWrite(
  db: TenancyDatabase,
  write: 'delete' | 'insert' | 'update',
  table: object,
  sneak: () => unknown,
): TenancyDatabase {
  let pending = true
  // Every gated builder proxy, mapped back to the real builder a batch runs.
  const targets = new WeakMap<object, object>()

  const wrap = <T extends object>(builder: T): T => {
    const proxy = new Proxy(builder, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        const method = value as Callable
        if (TERMINALS.has(property)) {
          return async (...args: unknown[]) => {
            if (pending) {
              pending = false
              await sneak()
            }
            return method.apply(target, args)
          }
        }
        return (...args: unknown[]) => {
          const result = method.apply(target, args)
          return typeof result === 'object' && result !== null ? wrap(result) : result
        }
      },
    })
    targets.set(proxy, builder)
    return proxy
  }

  const client = (db as { $client?: { transaction?: (fn: () => unknown) => () => unknown } })
    .$client
  const d1Batch = (db as { batch?: (statements: unknown[]) => Promise<unknown> }).batch
  const batch = async (statements: object[]) => {
    if (pending && statements.some((statement) => targets.has(statement))) {
      pending = false
      await sneak()
    }
    const real = statements.map((statement) => targets.get(statement) ?? statement)
    if (d1Batch) return d1Batch.call(db, real)
    if (!client?.transaction) throw new Error('interleaveBeforeWrite needs D1 or better-sqlite3.')
    return client.transaction(() =>
      real.map((statement) => (statement as { all: () => unknown }).all()),
    )()
  }

  return new Proxy(db, {
    get(target, property) {
      if (property === 'batch') return batch
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      const method = value as Callable
      if (property !== write) return method.bind(target)
      return (subject: unknown) => {
        const builder = method.call(target, subject)
        return subject === table && typeof builder === 'object' && builder !== null
          ? wrap(builder)
          : builder
      }
    },
  })
}
