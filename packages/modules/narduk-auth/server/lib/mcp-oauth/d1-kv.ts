import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm'

import { authOAuthKv } from '../../database/mcp-oauth-schema'

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

export type McpOAuthDatabase = Pick<
  BaseSQLiteDatabase<'async', unknown>,
  'select' | 'insert' | 'update' | 'delete'
>

/** The subset of Workers KV that @cloudflare/workers-oauth-provider calls. */
export interface McpOAuthKvNamespace {
  delete(key: string): Promise<void>
  get(key: string, options?: 'text' | 'json' | { type?: 'text' | 'json' }): Promise<unknown>
  list(options?: { cursor?: string | null; limit?: number; prefix?: string }): Promise<{
    cacheStatus: null
    cursor?: string
    keys: Array<{ expiration?: number; metadata?: unknown; name: string }>
    list_complete: boolean
  }>
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void>
}

const MAX_LIST_LIMIT = 1000
/** The highest code point: every key that starts with `prefix` sorts below `prefix + this`. */
const PREFIX_CEILING = '\u{10FFFF}'

function readType(options: Parameters<McpOAuthKvNamespace['get']>[1]): 'text' | 'json' {
  if (options === 'json' || (typeof options === 'object' && options?.type === 'json')) return 'json'
  return 'text'
}

function parseMetadata(raw: string | null): unknown {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Workers KV semantics on the `auth_oauth_kv` D1 table, so the OAuth library
 * keeps its storage layout while the rows live in the app's own database.
 * Expired rows read as absent; `purgeExpired()` deletes them.
 */
export function createD1KvNamespace(
  db: McpOAuthDatabase,
  clock: () => number = () => Math.floor(Date.now() / 1000),
): McpOAuthKvNamespace & {
  claimOnce(key: string, ttlSeconds: number): Promise<boolean>
  purgeExpired(): Promise<void>
  purgeExpiredPrefix(prefix: string, limit?: number): Promise<void>
} {
  const live = () => or(isNull(authOAuthKv.expiresAt), gt(authOAuthKv.expiresAt, clock()))

  return {
    async get(key, options) {
      const [row] = await db
        .select({ value: authOAuthKv.value })
        .from(authOAuthKv)
        .where(and(eq(authOAuthKv.key, key), live()))
        .limit(1)
      if (!row) return null
      return readType(options) === 'json' ? JSON.parse(row.value) : row.value
    },

    async put(key, value, options = {}) {
      if (typeof value !== 'string') throw new TypeError('auth_oauth_kv stores string values only')
      const expiresAt =
        options.expiration ??
        (options.expirationTtl === undefined ? null : clock() + options.expirationTtl)
      const metadata = options.metadata === undefined ? null : JSON.stringify(options.metadata)
      await db.insert(authOAuthKv).values({ key, value, metadata, expiresAt }).onConflictDoUpdate({
        target: authOAuthKv.key,
        set: { value, metadata, expiresAt },
      })
    },

    async delete(key) {
      await db.delete(authOAuthKv).where(eq(authOAuthKv.key, key))
    },

    async list(options = {}) {
      const prefix = options.prefix ?? ''
      const limit = Math.min(Math.max(options.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT)
      const conditions = [live(), gte(authOAuthKv.key, prefix)]
      if (prefix) conditions.push(lt(authOAuthKv.key, prefix + PREFIX_CEILING))
      if (options.cursor) conditions.push(gt(authOAuthKv.key, options.cursor))
      const rows = await db
        .select({
          key: authOAuthKv.key,
          metadata: authOAuthKv.metadata,
          expiresAt: authOAuthKv.expiresAt,
        })
        .from(authOAuthKv)
        .where(and(...conditions))
        .orderBy(asc(authOAuthKv.key))
        .limit(limit + 1)
      const page = rows.slice(0, limit)
      const complete = rows.length <= limit
      return {
        keys: page.map((row) => ({
          name: row.key,
          ...(row.expiresAt === null ? {} : { expiration: row.expiresAt }),
          ...(row.metadata === null ? {} : { metadata: parseMetadata(row.metadata) }),
        })),
        list_complete: complete,
        ...(complete ? {} : { cursor: page.at(-1)?.key }),
        cacheStatus: null,
      }
    },

    /**
     * Atomically create `key` unless it exists. `true` for the first caller
     * only; the single-statement insert is what makes it race-free on D1.
     */
    async claimOnce(key, ttlSeconds) {
      const rows = await db
        .insert(authOAuthKv)
        .values({ key, value: '1', metadata: null, expiresAt: clock() + ttlSeconds })
        .onConflictDoNothing()
        .returning({ key: authOAuthKv.key })
      return rows.length > 0
    },

    /** Bounded request-path cleanup for signed bridge replay markers only. */
    async purgeExpiredPrefix(prefix, requested = 50) {
      if (!prefix || prefix.length > 96 || !Number.isSafeInteger(requested) || requested < 1) {
        throw new Error('Invalid bounded OAuth cleanup')
      }
      const rows = await db
        .select({ key: authOAuthKv.key })
        .from(authOAuthKv)
        .where(
          and(
            gte(authOAuthKv.key, prefix),
            lt(authOAuthKv.key, prefix + PREFIX_CEILING),
            lte(authOAuthKv.expiresAt, clock()),
          ),
        )
        .orderBy(asc(authOAuthKv.key))
        .limit(Math.min(requested, 250))
      if (rows.length)
        await db.delete(authOAuthKv).where(
          and(
            inArray(
              authOAuthKv.key,
              rows.map((row) => row.key),
            ),
            lte(authOAuthKv.expiresAt, clock()),
          ),
        )
    },

    async purgeExpired() {
      await db.delete(authOAuthKv).where(lte(authOAuthKv.expiresAt, clock()))
    },
  }
}
