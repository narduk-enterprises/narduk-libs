/**
 * First-party usage counts for Cloudflare D1 apps: how often each screen is opened and each named
 * event happens, per day, role and platform. Nothing about a person is kept: no user id, session
 * id, IP address, query string or free text. The browser sends counts, the server decides the day
 * and the role (from its own session), and the app's own D1 stores the sums.
 *
 * The app owns its migration: copy `USAGE_COUNTS_DDL` into a new expand-only migration. Like
 * `./server-health`, everything here is structural (`D1Like`), with no `h3`, `nitropack` or
 * `@cloudflare/workers-types` import.
 */
import { collapseRoute } from './server-health.js'
import type { D1Like } from './server-health.js'

export type { D1Like, D1StatementLike } from './server-health.js'

export const USAGE_COUNTS_DDL = `CREATE TABLE usage_counts (
  day TEXT NOT NULL CHECK (length(day) = 10),
  kind TEXT NOT NULL CHECK (kind IN ('screen', 'event')),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  platform TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (day, kind, name, role, platform)
);`

export const USAGE_LIMITS = {
  /** Longest screen or event name kept. */
  nameMax: 120,
  /** Distinct items in one batch; more is refused, not truncated. */
  itemsPerBatch: 50,
  /** The most one item may add in one batch; a larger count is clamped to it. */
  countPerItem: 100,
  /** A batch body larger than this is refused before parsing. */
  bodyMaxBytes: 8192,
} as const

export type UsageKind = 'screen' | 'event'

export interface UsageItem {
  kind: UsageKind
  name: string
  count: number
}

export interface UsageBatch {
  schemaVersion: 1
  items: UsageItem[]
}

export interface UsageRow {
  day: string
  kind: UsageKind
  name: string
  role: string
  platform: string
  count: number
}

// ---- pure rules ------------------------------------------------------------------------------

/** An event name: lower case, starting with a letter, no spaces. A name is a label, never data. */
export const USAGE_EVENT_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/

/** A role or platform label: the app's own vocabulary, lower case. */
export const USAGE_LABEL = /^[a-z][a-z0-9_-]{0,39}$/

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A screen as a route pattern: Nuxt's parameter markers (`:id()`, `:slug(.*)*`) reduced to `:id`,
 * the query and hash dropped, and any opaque segment a raw path still carries collapsed to `:id`.
 * Null when what is left is not a path.
 */
export function usageScreenName(path: string): string | null {
  // Bounded quantifiers only, so hostile text stays linear (CodeQL js/polynomial-redos).
  const pattern = path
    .slice(0, USAGE_LIMITS.nameMax * 2)
    .replaceAll(/(:\w{1,64})\([^)]{0,64}\)[*+?]?/g, '$1')
  const name = collapseRoute(pattern)
  if (!name.startsWith('/') || /\s/.test(name)) return null
  return name.length > 1 ? name.replace(/\/+$/, '') : name
}

/** The calendar day of `at` in `timeZone` (an IANA name, default UTC), as `YYYY-MM-DD`. */
export function usageDay(at: Date, timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export interface ParsedUsageBatch {
  items: UsageItem[]
  /** Items refused for a bad kind, name or count. */
  dropped: number
}

/**
 * Validates a batch a client sent. Null when it is not a batch at all (wrong shape, wrong schema
 * version, too many items); otherwise the valid items, merged by kind and name, with counts
 * clamped, and how many were dropped. Screen names are normalized again here: the server never
 * trusts the client to have collapsed an id.
 *
 * Events are accepted only through `allowEvent`, the app's own list of event names: a name is
 * client text, and only a fixed vocabulary keeps a person's name or an id out of the table.
 * Without `allowEvent` every event is dropped. `allowScreen` narrows screens the same way (for
 * example to the app's route patterns); without it any path-shaped name is kept, after ids are
 * collapsed.
 */
export function parseUsageBatch(
  body: unknown,
  options: {
    allowEvent?: (name: string) => boolean
    allowScreen?: (name: string) => boolean
  } = {},
): ParsedUsageBatch | null {
  if (!body || typeof body !== 'object') return null
  const { schemaVersion, items } = body as { schemaVersion?: unknown; items?: unknown }
  if (schemaVersion !== 1 || !Array.isArray(items)) return null
  if (items.length === 0 || items.length > USAGE_LIMITS.itemsPerBatch) return null
  const merged = new Map<string, UsageItem>()
  let dropped = 0
  for (const raw of items as unknown[]) {
    const item = raw as { kind?: unknown; name?: unknown; count?: unknown } | null
    const count = typeof item?.count === 'number' ? item.count : Number.NaN
    const name = typeof item?.name === 'string' ? item.name : ''
    let kept: string | null = null
    if (item?.kind === 'screen') {
      kept = usageScreenName(name)
      if (kept && options.allowScreen && !options.allowScreen(kept)) kept = null
    } else if (item?.kind === 'event' && USAGE_EVENT_NAME.test(name))
      kept = options.allowEvent?.(name) ? name : null
    if (!kept || kept.length > USAGE_LIMITS.nameMax || !Number.isInteger(count) || count < 1) {
      dropped++
      continue
    }
    const kind = item!.kind as UsageKind
    const key = `${kind}\n${kept}`
    const prior = merged.get(key)
    merged.set(key, {
      kind,
      name: kept,
      count: Math.min(USAGE_LIMITS.countPerItem, (prior?.count ?? 0) + count),
    })
  }
  return { items: [...merged.values()], dropped }
}

// ---- storage ---------------------------------------------------------------------------------

/**
 * Adds a batch's counts to the day's rows for one role and platform, in one D1 batch. The caller
 * decides `day` (`usageDay`) and `role` from its own session, never from the client.
 */
export async function recordUsage(
  db: D1Like,
  input: { day: string; role: string; platform: string; items: readonly UsageItem[] },
): Promise<void> {
  if (!DAY.test(input.day)) throw new TypeError('usage day must be YYYY-MM-DD')
  if (!USAGE_LABEL.test(input.role)) throw new TypeError('usage role must be a lower-case label')
  if (!USAGE_LABEL.test(input.platform))
    throw new TypeError('usage platform must be a lower-case label')
  if (input.items.length === 0) return
  await db.batch(
    input.items.slice(0, USAGE_LIMITS.itemsPerBatch).map((item) =>
      db
        .prepare(
          `INSERT INTO usage_counts (day, kind, name, role, platform, count) VALUES (?,?,?,?,?,?)
           ON CONFLICT(day, kind, name, role, platform) DO UPDATE SET count = count + excluded.count`,
        )
        .bind(
          input.day,
          item.kind,
          item.name.slice(0, USAGE_LIMITS.nameMax),
          input.role,
          input.platform,
          Math.min(USAGE_LIMITS.countPerItem, Math.max(1, Math.trunc(item.count))),
        ),
    ),
  )
}

/** Deletes every row older than `before` (a `YYYY-MM-DD` day, kept). */
export async function pruneUsage(db: D1Like, before: string): Promise<void> {
  if (!DAY.test(before)) throw new TypeError('usage day must be YYYY-MM-DD')
  await db.prepare('DELETE FROM usage_counts WHERE day < ?').bind(before).run()
}

const LIST_MAX = 5000

/** Rows from `since` through `until` (inclusive days), newest day first, at most `limit` (5 000). */
export async function listUsage(
  db: D1Like,
  query: { since: string; until?: string; kind?: UsageKind; limit?: number },
): Promise<UsageRow[]> {
  if (!DAY.test(query.since) || (query.until !== undefined && !DAY.test(query.until)))
    throw new TypeError('usage day must be YYYY-MM-DD')
  const { results } = await db
    .prepare(
      `SELECT day, kind, name, role, platform, count FROM usage_counts
       WHERE day >= ? AND day <= ? AND (? IS NULL OR kind = ?)
       ORDER BY day DESC, count DESC, kind, name, role, platform LIMIT ?`,
    )
    .bind(
      query.since,
      query.until ?? '9999-12-31',
      query.kind ?? null,
      query.kind ?? null,
      Math.min(Math.max(1, query.limit ?? LIST_MAX), LIST_MAX),
    )
    .all<UsageRow>()
  return results.map((r) => ({
    day: r.day,
    kind: r.kind,
    name: r.name,
    role: r.role,
    platform: r.platform,
    count: Number(r.count),
  }))
}

/** Sums rows by one column, largest first (ties by key). */
export function usageTotals(
  rows: readonly UsageRow[],
  by: 'day' | 'kind' | 'name' | 'role' | 'platform',
): Array<{ key: string; count: number }> {
  const sums = new Map<string, number>()
  for (const row of rows) sums.set(row[by], (sums.get(row[by]) ?? 0) + row.count)
  return [...sums]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

// ---- client ----------------------------------------------------------------------------------

export interface UsageReporter {
  /** Counts one open of the screen at `path` (a route pattern or a raw path). A repeat of the screen just counted is ignored. */
  screen(path: string): void
  /** Counts one named event. A name that is not `USAGE_EVENT_NAME` is ignored. */
  event(name: string): void
  /** Sends what is pending as one batch and clears it; returns the batch, or null when nothing was pending. */
  flush(): UsageBatch | null
}

/**
 * Collects counts in memory and hands them to `send` as batches: on `flush()`, and by itself when
 * `maxPending` distinct items are waiting. It never throws, keeps nothing between page loads and
 * has no timer of its own; wire `flush` to the page's lifecycle (`installUsageFlush`).
 */
export function createUsageReporter(options: {
  send: (batch: UsageBatch) => void
  maxPending?: number
}): UsageReporter {
  const maxPending = Math.min(
    Math.max(1, options.maxPending ?? USAGE_LIMITS.itemsPerBatch),
    USAGE_LIMITS.itemsPerBatch,
  )
  const pending = new Map<string, UsageItem>()
  let lastScreen: string | null = null
  const flush = (): UsageBatch | null => {
    if (pending.size === 0) return null
    const batch: UsageBatch = { schemaVersion: 1, items: [...pending.values()] }
    pending.clear()
    try {
      options.send(batch)
    } catch {
      // usage is best effort; a failed send is dropped
    }
    return batch
  }
  const add = (kind: UsageKind, name: string) => {
    const key = `${kind}\n${name}`
    const item = pending.get(key)
    if (item) item.count = Math.min(USAGE_LIMITS.countPerItem, item.count + 1)
    else pending.set(key, { kind, name, count: 1 })
    if (pending.size >= maxPending) flush()
  }
  return {
    screen(path) {
      const name = usageScreenName(path)
      if (!name || name === lastScreen) return
      lastScreen = name
      add('screen', name)
    },
    event(name) {
      if (USAGE_EVENT_NAME.test(name)) add('event', name)
    },
    flush,
  }
}

/**
 * A `send` for `createUsageReporter`: a same-origin `fetch` with `keepalive`, so a batch sent as
 * the page hides still arrives. Cookies go with it, because the server reads the role from its own
 * session. `headers` adds what the app's CSRF check wants (for example `x-requested-with`).
 */
export function createUsageSender(options: {
  endpoint: string
  fetch?: typeof fetch
  headers?: Record<string, string>
}): (batch: UsageBatch) => void {
  // `//host` and `/\host` both resolve to another origin in a browser.
  if (!/^\/(?![/\\])/.test(options.endpoint)) {
    throw new TypeError('Usage endpoint must be a same-origin absolute path')
  }
  return (batch) => {
    const body = JSON.stringify(batch)
    if (body.length > USAGE_LIMITS.bodyMaxBytes) return
    void (options.fetch ?? fetch)(options.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      keepalive: true,
      headers: { 'content-type': 'application/json', ...options.headers },
      body,
    }).catch(() => {})
  }
}

/** The slice of `window` and `document` `installUsageFlush` listens on. */
export interface UsageFlushTarget {
  addEventListener(type: 'pagehide', listener: () => void): void
  removeEventListener(type: 'pagehide', listener: () => void): void
  document?: {
    visibilityState?: string
    addEventListener(type: 'visibilitychange', listener: () => void): void
    removeEventListener(type: 'visibilitychange', listener: () => void): void
  }
}

/** Flushes when the page is hidden or left. Returns a dispose function. */
export function installUsageFlush(reporter: UsageReporter, target: UsageFlushTarget): () => void {
  const onHide = () => {
    reporter.flush()
  }
  const onVisibility = () => {
    if (target.document?.visibilityState === 'hidden') reporter.flush()
  }
  target.addEventListener('pagehide', onHide)
  target.document?.addEventListener('visibilitychange', onVisibility)
  return () => {
    target.removeEventListener('pagehide', onHide)
    target.document?.removeEventListener('visibilitychange', onVisibility)
  }
}
