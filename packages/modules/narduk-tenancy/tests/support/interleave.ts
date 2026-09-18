import type { TenancyDatabase } from '../../server/utils/tenancy'

type Callable = (...args: unknown[]) => unknown

const TERMINALS = new Set<PropertyKey>(['all', 'get', 'run'])

/**
 * `db`, except that the first `write` against `table` runs `sneak` just before
 * it executes: after the service has read everything it checks, and before its
 * own write lands. That is the interleaving a concurrent request produces, made
 * deterministic, and it works the same on better-sqlite3 and on D1 because it
 * sits on the drizzle builder rather than on either driver.
 */
export function interleaveBeforeWrite(
  db: TenancyDatabase,
  write: 'delete' | 'update',
  table: object,
  sneak: () => unknown,
): TenancyDatabase {
  let pending = true

  const wrap = <T extends object>(builder: T): T =>
    new Proxy(builder, {
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

  return new Proxy(db, {
    get(target, property) {
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
