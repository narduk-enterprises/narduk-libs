import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { Logger } from '../utils/logger'
import type { LayerDatabase } from '../utils/database'

declare module 'h3' {
  interface H3EventContext {
    /** Cloudflare Worker runtime context (nuxt/nitro binding shape). */
    cloudflare?: {
      context?: {
        waitUntil?: (promise: Promise<unknown>) => void
      }
      env?: Record<string, unknown>
    }
    /** Alternate platform event context used by some runtime bridges. */
    _platform?: {
      cloudflare?: {
        env?: Record<string, unknown>
      }
    }
    /**
     * Per-request Drizzle database instance, memoized by useDatabase(). Typed as
     * the D1-flavored layer schema; Postgres is wrapped to match the same
     * surface at runtime.
     */
    _db?: LayerDatabase
    /**
     * Per-request app-level Drizzle instance, memoized by createAppDatabase(),
     * using the app’s merged D1-style schema.
     */
    _appDb?: DrizzleD1Database<Record<string, unknown>>
    /** Per-request correlation ID, set by requestLogger middleware */
    _requestId?: string
    /** Per-request structured logger, memoized by useLogger() */
    _logger?: Logger
  }
}
