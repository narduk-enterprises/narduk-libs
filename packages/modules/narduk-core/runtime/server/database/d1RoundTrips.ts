/// <reference types="@cloudflare/workers-types" />

/**
 * D1 round-trip counting for `useDatabase` (narduk-libs#511).
 *
 * narduk-logging's `QueryCounter` (narduk-libs#325, #504) is driver-agnostic:
 * the wrapper around a binding calls `recordRoundTrip(n)` once per call into
 * the binding. This is that wrapper for D1:
 *
 * - `first` / `all` / `run` / `raw` on a prepared statement → one round trip,
 *   one statement.
 * - `batch(statements)` → one round trip, `statements.length` statements.
 *
 * Statements come back from `prepare` and `bind` wrapped, so drizzle's own
 * `prepare(sql).bind(...params).all()` is counted without drizzle knowing.
 * `batch` hands the *original* statements to the real binding: workerd
 * rejects a statement object it did not create.
 *
 * Recording never throws into the query. A recorder that throws (no request
 * state, a logging stub in a test) is swallowed — an instrument must not be
 * able to fail the request it is measuring.
 */

export type RoundTripRecorder = (statements?: number) => void

const STATEMENT_CALLS = new Set<PropertyKey>(['first', 'all', 'run', 'raw'])
const ORIGINAL = Symbol('narduk-core.d1.original')

function safeRecord(record: RoundTripRecorder, statements?: number): void {
  try {
    record(statements)
  } catch {
    // Counting is diagnostics; the query goes ahead regardless.
  }
}

function unwrapStatement(statement: unknown): unknown {
  if (statement && typeof statement === 'object') {
    const original = (statement as Record<PropertyKey, unknown>)[ORIGINAL]
    if (original) return original
  }
  return statement
}

function wrapStatement<T extends object>(statement: T, record: RoundTripRecorder): T {
  return new Proxy(statement, {
    get(target, prop) {
      if (prop === ORIGINAL) return target
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (STATEMENT_CALLS.has(prop)) {
        return (...args: unknown[]) => {
          safeRecord(record, 1)
          return Reflect.apply(value, target, args) as unknown
        }
      }
      if (prop === 'bind') {
        return (...args: unknown[]) =>
          wrapStatement(Reflect.apply(value, target, args) as object, record)
      }
      return (value as (...args: unknown[]) => unknown).bind(target)
    },
  })
}

/**
 * Wrap a D1 binding so every call into it records a round trip through
 * `record`. The returned binding is otherwise the original: every other
 * property and method is forwarded to it unchanged.
 */
export function countD1RoundTrips<T extends object>(binding: T, record: RoundTripRecorder): T {
  return new Proxy(binding, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'prepare') {
        return (...args: unknown[]) =>
          wrapStatement(Reflect.apply(value, target, args) as object, record)
      }
      if (prop === 'batch') {
        return (statements: unknown, ...rest: unknown[]) => {
          if (!Array.isArray(statements)) {
            // Let the real binding reject a malformed call; it is not a round trip.
            return Reflect.apply(value, target, [statements, ...rest]) as unknown
          }
          safeRecord(record, statements.length)
          return Reflect.apply(value, target, [statements.map(unwrapStatement), ...rest]) as unknown
        }
      }
      return (value as (...args: unknown[]) => unknown).bind(target)
    },
  })
}
