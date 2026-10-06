import { isStandardAnalyticsEvent } from './analyticsCatalog'

import type { standardAnalyticsEvents } from '../utils/analyticsEvents'
import type { AnalyticsTransport } from '../utils/analyticsTransport'
import type { AnalyticsCatalog } from './analyticsCatalog'
import type { z } from 'zod'

/**
 * Runtime validation without Zod on the critical path (narduk-libs#1527).
 *
 * The shared schemas are loaded with `import()` the first time an event needs
 * them. Until they arrive, a capture is queued here and validated, with the same
 * schemas and the same rules, once they do. Captures stay in call order: while
 * anything is waiting, later captures queue behind it even when their own schema
 * is already available.
 */

type Schema = z.ZodType<Record<string, unknown>>
type StandardCatalog = typeof standardAnalyticsEvents
export type AnalyticsCatalogLoader<T extends AnalyticsCatalog = AnalyticsCatalog> =
  () => PromiseLike<T>
/** What `useAnalytics` accepts: a built catalog, or a function that loads one on demand. */
export type AnalyticsCatalogSource<T extends AnalyticsCatalog = AnalyticsCatalog> =
  T | AnalyticsCatalogLoader<T>

let standardCatalog: StandardCatalog | undefined
let standardLoading: Promise<StandardCatalog> | undefined

export function loadStandardAnalyticsEvents(): Promise<StandardCatalog> {
  standardLoading ??= import('../utils/analyticsEvents').then(
    (module) => (standardCatalog = module.standardAnalyticsEvents),
    (error: unknown) => {
      // A failed chunk fetch must not poison later captures: allow a retry.
      standardLoading = undefined
      throw error
    },
  )
  return standardLoading
}

/** True once the shared schemas are in memory; tests use it to prove laziness. */
export function standardAnalyticsEventsLoaded() {
  return standardCatalog !== undefined
}

const catalogs = new WeakMap<
  AnalyticsCatalogLoader,
  { loaded?: AnalyticsCatalog; loading?: Promise<AnalyticsCatalog> }
>()

function loadCatalog(loader: AnalyticsCatalogLoader): Promise<AnalyticsCatalog> {
  const entry = catalogs.get(loader) ?? {}
  catalogs.set(loader, entry)
  entry.loading ??= new Promise<AnalyticsCatalog>((resolve) => resolve(loader())).then(
    (catalog) => (entry.loaded = catalog),
    (error: unknown) => {
      entry.loading = undefined
      throw error
    },
  )
  return entry.loading
}

/** The app's catalog if it is already in hand, else undefined while a loader still has to run. */
function catalogIfLoaded(source: AnalyticsCatalogSource | undefined): AnalyticsCatalog | undefined {
  if (source === undefined) return {}
  if (typeof source !== 'function') return source
  return catalogs.get(source)?.loaded
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T> | undefined)?.then === 'function'
}

function noop() {}
/** Stands in for a schema that could not be loaded. */
const NO_SCHEMA = undefined as Schema | undefined

let pending = 0
let tail: Promise<unknown> = Promise.resolve()

/** Runs `task` after every earlier queued capture has finished; a failed task never blocks the rest. */
function enqueue(task: () => unknown): void {
  pending += 1
  tail = tail
    .then(task)
    .catch(noop)
    .finally(() => {
      pending -= 1
    })
}

/** Resolves once every queued capture has been validated and sent or dropped. */
export async function analyticsValidationSettled(): Promise<void> {
  let seen: Promise<unknown>
  do {
    seen = tail
    await seen
  } while (seen !== tail)
}

type SchemaLookup = Schema | undefined | PromiseLike<Schema | undefined>

function standardSchema(event: string): SchemaLookup {
  const catalog = standardCatalog
  if (catalog) return (catalog as Record<string, Schema>)[event]
  return loadStandardAnalyticsEvents().then((loaded) => (loaded as Record<string, Schema>)[event])
}

function appSchema(source: AnalyticsCatalogSource | undefined, event: string): SchemaLookup {
  const catalog = catalogIfLoaded(source)
  if (catalog) return catalog[event]
  return loadCatalog(source as AnalyticsCatalogLoader).then((loaded) => loaded[event])
}

/**
 * Validates `properties` against the event's schema and hands the parsed value to
 * the transport. An invalid event is rejected exactly as before: nothing reaches
 * the transport, and nothing unvalidated is ever sent.
 *
 * Returns what a caller can know synchronously. With the schema in memory that is
 * the true result (`false` for an unknown event, invalid properties, or a
 * transport that is not accepting events). While the schema is still loading it is
 * `true`, meaning "accepted for validation": the same promise `capture` already
 * makes while the SDK is pending, and invalid events are dropped when the schema
 * arrives. A transport that is disabled or failed returns `false` immediately and
 * never loads Zod.
 */
export function captureValidated(
  transport: AnalyticsTransport | undefined,
  event: string,
  properties: unknown,
  source?: AnalyticsCatalogSource,
): boolean {
  if (!transport || (transport.status !== 'pending' && transport.status !== 'ready')) return false
  const lookup = isStandardAnalyticsEvent(event) ? standardSchema(event) : appSchema(source, event)
  const send = (schema: Schema | undefined, context?: Record<string, unknown>) => {
    if (!schema) return false
    const parsed = schema.safeParse(properties)
    return parsed.success ? transport.capture(event, parsed.data, context) : false
  }

  if (!isPromiseLike(lookup) && pending === 0) {
    // Nothing is waiting, so this capture is decided now, with today's semantics.
    return send(lookup)
  }
  // The route a capture belongs to is the one at the call, not the one at the flush.
  const context = transport.context()
  // A loader that rejects leaves no schema, so the event is dropped like any unknown one.
  const settled = Promise.resolve(lookup).then(
    (schema): Schema | undefined => schema,
    () => NO_SCHEMA,
  )
  enqueue(async () => {
    send(await settled, context)
  })
  return true
}
