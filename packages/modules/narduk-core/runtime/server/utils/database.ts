/// <reference types="@cloudflare/workers-types" />
import { drizzle as drizzleD1, type DrizzleD1Database } from 'drizzle-orm/d1'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { createPostgresDatabase } from '#narduk-core/postgres-runtime'

import * as pgSchema from '../database/pg-schema'
import * as d1Schema from '../database/schema'

import { useHyperdriveConnectionString } from './hyperdrive'
import { useLogger } from './logger'
import { readWorkerRuntimeEnv } from './worker-env'

import type { H3Event } from 'h3'

/**
 * Public database typing intentionally stays D1-shaped across both backends.
 *
 * The Postgres path is wrapped so downstream code can keep using `.get()`,
 * `.all()`, and `.run()` without branching on the runtime dialect.
 */
export type LayerDatabase = DrizzleD1Database<typeof d1Schema>
type AppDatabase<TSchema extends Record<string, unknown>> = DrizzleD1Database<TSchema>
interface AppSchemaMap<TD1 extends Record<string, unknown>, TPG extends Record<string, unknown>> {
  d1: TD1
  pg: TPG
}

const QUERY_COMPAT_METHODS = new Set(['all', 'get', 'run'])
const QUERY_PROMISE_METHODS = new Set(['then', 'catch', 'finally'])
const pgCompatCache = new WeakMap<object, object>()

interface LayerRequestContext {
  _appDb?: AppDatabase<Record<string, unknown>>
  _db?: LayerDatabase
}

function getLayerRequestContext(event: H3Event) {
  return event.context as H3Event['context'] & LayerRequestContext
}

function makeLogger(event: H3Event, label: string) {
  return import.meta.dev
    ? {
        logQuery(query: string, params: unknown) {
          useLogger(event).child(label).debug('sql', { query, params })
        },
      }
    : undefined
}

function executeCompatQuery(query: unknown) {
  if (
    query &&
    typeof query === 'object' &&
    'execute' in query &&
    typeof query.execute === 'function'
  ) {
    return query.execute()
  }

  return Promise.resolve(query)
}

export async function executeDatabaseQuery<TResult>(query: unknown): Promise<TResult> {
  return (await executeCompatQuery(query)) as TResult
}

export async function getDatabaseRow<TResult>(query: unknown): Promise<TResult | undefined> {
  const result = await executeCompatQuery(query)
  if (Array.isArray(result)) {
    return result[0] as TResult | undefined
  }

  return result as TResult | undefined
}

export async function getDatabaseRows<TResult>(query: unknown): Promise<TResult[]> {
  const result = await executeCompatQuery(query)
  if (Array.isArray(result)) {
    return result as TResult[]
  }

  return result == null ? [] : [result as TResult]
}

interface ExecutableDatabase {
  execute: (query: unknown) => Promise<unknown>
}

function hasExecutableDatabaseQuery(value: unknown): value is ExecutableDatabase {
  return (
    typeof value === 'object' &&
    value !== null &&
    'execute' in value &&
    typeof value.execute === 'function'
  )
}

export async function probeDatabaseConnection(event: H3Event, query: unknown): Promise<void> {
  const db = useDatabase(event)
  if (hasExecutableDatabaseQuery(db)) {
    await db.execute(query)
    return
  }

  await getDatabaseRow(query)
}

function wrapPgCompat<T>(value: T): T {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return value
  }

  const cached = pgCompatCache.get(value as object)
  if (cached) {
    return cached as T
  }

  const proxy = new Proxy(value as object, {
    get(target, prop, receiver) {
      if (QUERY_COMPAT_METHODS.has(String(prop))) {
        if (prop === 'get') {
          return async () => {
            const rows = await executeCompatQuery(target)
            return Array.isArray(rows) ? (rows[0] ?? undefined) : rows
          }
        }

        return () => executeCompatQuery(target)
      }

      const raw = Reflect.get(target, prop, receiver)
      if (typeof raw !== 'function') {
        return raw
      }

      if (QUERY_PROMISE_METHODS.has(String(prop))) {
        return raw.bind(target)
      }

      return (...args: unknown[]) => wrapPgCompat(raw.apply(target, args))
    },
  })

  pgCompatCache.set(value as object, proxy)
  return proxy as T
}

function isAppSchemaMap<TD1 extends Record<string, unknown>, TPG extends Record<string, unknown>>(
  value: TD1 | AppSchemaMap<TD1, TPG>,
): value is AppSchemaMap<TD1, TPG> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'd1' in value &&
    'pg' in value &&
    typeof value.d1 === 'object' &&
    value.d1 !== null &&
    typeof value.pg === 'object' &&
    value.pg !== null
  )
}

function isCloudflareScheduledEvent(event: H3Event): boolean {
  const context = event.context as
    | {
        _platform?: { cloudflare?: { scheduled?: unknown } }
        cloudflare?: { scheduled?: unknown }
      }
    | undefined
  return (
    context?.cloudflare?.scheduled !== undefined ||
    context?._platform?.cloudflare?.scheduled !== undefined
  )
}

function resolveDatabaseBackend(event: H3Event): unknown {
  try {
    return (useRuntimeConfig(event) as Record<string, unknown>).databaseBackend ?? 'd1'
  } catch (error) {
    if (isCloudflareScheduledEvent(event)) {
      return 'd1'
    }
    throw error
  }
}

/**
 * Return a Drizzle ORM instance for the current request.
 *
 * - `d1` (default): Cloudflare D1 via the `DB` binding.
 * - `postgres`: Hyperdrive connection string + `postgres.js` + Drizzle postgres-js.
 *
 * Memoized on `event.context._db`. Postgres builds must use `NUXT_DATABASE_BACKEND=postgres`
 * so `#narduk-core/schema` and this schema stay aligned.
 */
export function useDatabase(event: H3Event): LayerDatabase {
  const context = getLayerRequestContext(event)
  if (context._db) {
    return context._db
  }

  const backend = resolveDatabaseBackend(event)

  if (backend === 'postgres') {
    const connectionString = useHyperdriveConnectionString(event)
    const db = wrapPgCompat(
      createPostgresDatabase(connectionString, {
        schema: pgSchema,
        logger: makeLogger(event, 'PG'),
      }),
    )
    context._db = db as unknown as LayerDatabase
    return db as unknown as LayerDatabase
  }

  const cfEnv = readWorkerRuntimeEnv(event)
  const d1Binding = (cfEnv as { DB?: D1Database }).DB
  if (!d1Binding) {
    throw createError({
      statusCode: 500,
      message: 'D1 database binding not available. Ensure DB is configured in wrangler.json.',
    })
  }

  const db = drizzleD1(d1Binding, {
    schema: d1Schema,
    logger: makeLogger(event, 'D1'),
  })
  context._db = db
  return db
}

/**
 * Factory to create an app-level Drizzle accessor with typed schema.
 *
 * Pass a single schema object for D1-only apps, or a `{ d1, pg }` pair when
 * the app owns backend-specific schema mirrors.
 *
 * @example
 * ```ts
 * import * as schema from '../database/schema'
 * export const useAppDatabase = createAppDatabase(schema)
 * ```
 */
export function createAppDatabase<
  TD1 extends Record<string, unknown>,
  TPG extends Record<string, unknown> = TD1,
>(appSchema: TD1 | AppSchemaMap<TD1, TPG>) {
  return (event: H3Event): AppDatabase<TD1> => {
    const context = getLayerRequestContext(event)
    if (context._appDb) {
      return context._appDb as AppDatabase<TD1>
    }

    const backend = resolveDatabaseBackend(event)
    const resolvedSchema = isAppSchemaMap(appSchema)
      ? appSchema
      : {
          d1: appSchema,
          pg: appSchema as unknown as TPG,
        }

    if (backend === 'postgres') {
      const connectionString = useHyperdriveConnectionString(event)
      const db = wrapPgCompat(
        createPostgresDatabase(connectionString, {
          schema: resolvedSchema.pg,
          logger: makeLogger(event, 'PG'),
        }),
      )
      context._appDb = db as unknown as AppDatabase<TD1>
      return db as unknown as AppDatabase<TD1>
    }

    const cfEnv = readWorkerRuntimeEnv(event)
    const d1Binding = (cfEnv as { DB?: D1Database }).DB
    if (!d1Binding) {
      throw createError({
        statusCode: 500,
        message: 'D1 database binding not available. Ensure DB is configured in wrangler.json.',
      })
    }

    const db = drizzleD1(d1Binding, {
      schema: resolvedSchema.d1,
      logger: makeLogger(event, 'D1'),
    })
    context._appDb = db
    return db
  }
}
