/**
 * List-query contract — one query shape for every list route in the estate.
 *
 * `listQuerySchema()` builds a zod object: a limit clamped to the route's own
 * ceiling, a sort restricted to an allowlist, a bounded free-text `q`, the
 * caller's allowlisted filters, and either an `offset` or a `cursor`.
 *
 * An unknown key is never silently **stripped** — silent stripping is the bug
 * class the components-library plan (§2 item 10) names in riverstatus's
 * per-route schemas, where a typo'd or renamed parameter reads as "no filter"
 * and the route answers with the wrong page. For one release it is instead
 * **tolerated**: the request still succeeds with the known keys parsed
 * exactly as before, and every ignored key comes back on `unknownKeys` so a
 * caller (narduk-core's `parseListQuery`) can report it. Pass `strict: true`
 * to reject an unknown key with a 400 today; the next major flips that
 * default. See `.changeset/list-query-tolerate-unknown-keys.md`.
 *
 * The helpers that bind this to an h3 event (`parseListQuery`, `listResponse`)
 * live in narduk-core's server utils; this package owns the shape and the types
 * so a client can share them without importing a server runtime.
 */
import { z } from 'zod'

/** Wire keys the contract owns. A filter may not reuse one. */
export const LIST_QUERY_RESERVED_KEYS = ['cursor', 'limit', 'offset', 'q', 'sort'] as const

/** Page size used when the caller sends no `limit` (clamped to `maxLimit`). */
export const LIST_QUERY_DEFAULT_LIMIT = 25

/** Longest accepted `q`, measured after trimming. */
export const LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH = 200

/**
 * Maximum SQL statements a list route may issue per request: one page
 * `SELECT`, plus one `COUNT(*)` when it returns a numeric `total`.
 *
 * Routes that set `total: null` stay at one statement. `listQuerySchema` /
 * `parseListQuery` cannot count statements — they never talk to a database —
 * so this constant is the contract, and route tests that wrap the D1 binding
 * (narduk-auth users/notifications, narduk-ai system-prompts) enforce it.
 */
export const LIST_QUERY_STATEMENT_CEILING = 2

export type ListQueryMode = 'cursor' | 'offset'
export type ListSortDirection = 'asc' | 'desc'

/** Anything a route can produce from its filter schema. */
export type ListFilters = Record<string, unknown>
export type EmptyListFilters = Record<string, never>

export interface ListSort<TKey extends string = string> {
  direction: ListSortDirection
  key: TKey
}

/**
 * A parsed list query. Exactly one of `cursor` / `offset` is present at
 * runtime, decided by `mode`; the narrowed `CursorListQuery` and
 * `OffsetListQuery` say which.
 */
export interface ListQuery<TFilters = EmptyListFilters, TKey extends string = string> {
  /** Cursor mode only. `null` when the caller sent none. */
  cursor?: string | null
  filters: TFilters
  limit: number
  mode: ListQueryMode
  /** Offset mode only. */
  offset?: number
  q: string | null
  sort: ListSort<TKey> | null
  /**
   * Query keys the caller sent that this route does not declare. Always `[]`
   * with `strict: true` — an unknown key fails parsing before this field
   * would ever be produced. Otherwise every ignored key is named here so a
   * caller can warn on it; the value is never merged into `filters`.
   */
  unknownKeys: string[]
}

export interface OffsetListQuery<
  TFilters = EmptyListFilters,
  TKey extends string = string,
> extends ListQuery<TFilters, TKey> {
  mode: 'offset'
  offset: number
}

export interface CursorListQuery<
  TFilters = EmptyListFilters,
  TKey extends string = string,
> extends ListQuery<TFilters, TKey> {
  cursor: string | null
  mode: 'cursor'
}

/** The half of a list response both modes share. */
export interface ListResponseBase<TItem> {
  items: TItem[]
  limit: number
  q: string | null
  /** Echoed in wire form (`'<key>:<asc|desc>'`) so a client can send it back. */
  sort: string | null
  /** `null` when the route deliberately does not count. */
  total: number | null
}

export interface OffsetListResponse<TItem> extends ListResponseBase<TItem> {
  offset: number
}

export interface CursorListResponse<TItem> extends ListResponseBase<TItem> {
  nextCursor: string | null
}

export type ListResponse<TItem, TMode extends ListQueryMode = 'offset'> = TMode extends 'cursor'
  ? CursorListResponse<TItem>
  : OffsetListResponse<TItem>

export interface ListQuerySchemaOptions<
  TSortable extends readonly string[] = readonly string[],
  TFilters extends z.ZodObject = z.ZodObject<Record<string, never>>,
  TMode extends ListQueryMode = 'offset',
> {
  /** Page size when the caller sends none. Clamped to `maxLimit`. */
  defaultLimit?: number
  /** Sort applied when the caller sends none. Must satisfy `sortable`. */
  defaultSort?: `${TSortable[number]}:${ListSortDirection}`
  /** Allowlisted filters, flattened onto the query string alongside `limit`. */
  filters?: TFilters
  /** The route's own page ceiling. A larger `limit` is clamped, not rejected. */
  maxLimit: number
  /** Longest accepted `q`, after trimming. Defaults to 200. */
  maxQueryLength?: number
  /** `'offset'` (default) or `'cursor'`. */
  mode?: TMode
  /**
   * Whether the route actually applies `q`. Defaults to `true`. A route that
   * does not search sets `false`, so a non-empty `q` is rejected rather than
   * accepted and silently ignored — an ignored filter reads to the caller as
   * "no match narrowed the page" and hands back the wrong rows.
   */
  searchable?: boolean
  /** Allowlisted sort keys. */
  sortable: TSortable
  /**
   * Reject an unknown query key with a 400 instead of tolerating it.
   * Defaults to `false` for one release (tolerate-and-warn, Logan
   * 2026-09-11); the next major flips this default to `true`. See
   * `.changeset/list-query-tolerate-unknown-keys.md`.
   */
  strict?: boolean
}

/** Renders a parsed sort back into its wire form. */
export function formatListSort(sort: ListSort | null | undefined): string | null {
  return sort ? `${sort.key}:${sort.direction}` : null
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`listQuerySchema: ${label} must be a positive integer, received ${value}.`)
  }
}

function readSort(value: string, sortable: readonly string[]): ListSort | null {
  const parts = value.split(':')
  if (parts.length !== 2) return null

  const [key, direction] = parts
  if (!key || !sortable.includes(key)) return null
  if (direction !== 'asc' && direction !== 'desc') return null

  return { direction, key }
}

interface ListQueryWireValue {
  [key: string]: unknown
  cursor?: string
  limit?: number
  offset?: number
  q?: string | null
  sort?: ListSort | null
}

function buildListQuerySchema(
  options: ListQuerySchemaOptions<readonly string[], z.ZodObject, ListQueryMode>,
): z.ZodType<ListQuery<ListFilters, string>, unknown> {
  const mode = options.mode ?? 'offset'
  const maxQueryLength = options.maxQueryLength ?? LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH
  assertPositiveInteger(options.maxLimit, 'maxLimit')
  assertPositiveInteger(maxQueryLength, 'maxQueryLength')

  const defaultLimit = Math.min(options.defaultLimit ?? LIST_QUERY_DEFAULT_LIMIT, options.maxLimit)
  assertPositiveInteger(defaultLimit, 'defaultLimit')

  if (options.sortable.length === 0 && options.defaultSort) {
    throw new TypeError('listQuerySchema: defaultSort needs a non-empty sortable allowlist.')
  }

  const defaultSort = options.defaultSort ? readSort(options.defaultSort, options.sortable) : null
  if (options.defaultSort && !defaultSort) {
    throw new TypeError(
      `listQuerySchema: defaultSort '${options.defaultSort}' is not '<key>:<asc|desc>' over [${options.sortable.join(', ')}].`,
    )
  }

  const filterShape: z.ZodRawShape = options.filters ? options.filters.shape : {}
  const collisions = Object.keys(filterShape).filter((key) =>
    (LIST_QUERY_RESERVED_KEYS as readonly string[]).includes(key),
  )
  if (collisions.length > 0) {
    throw new TypeError(
      `listQuerySchema: filter keys collide with reserved query keys: ${collisions.join(', ')}.`,
    )
  }

  const limitSchema = z.coerce
    .number()
    .int()
    .positive()
    .transform((value) => Math.min(value, options.maxLimit))

  const sortSchema = z
    .string()
    .transform((value) => value.trim())
    .superRefine((value, ctx) => {
      if (readSort(value, options.sortable)) return
      ctx.addIssue({
        code: 'custom',
        message:
          options.sortable.length === 0
            ? 'sort is not supported by this route'
            : `sort must be '<key>:<asc|desc>' with key in [${options.sortable.join(', ')}]`,
      })
    })
    .transform((value) => readSort(value, options.sortable))

  const searchable = options.searchable ?? true
  const freeTextSchema = z
    .string()
    .transform((value) => value.trim())
    .superRefine((value, ctx) => {
      if (!searchable) {
        if (value.length === 0) return
        ctx.addIssue({ code: 'custom', message: 'q is not supported by this route' })
        return
      }

      if (value.length <= maxQueryLength) return
      ctx.addIssue({ code: 'custom', message: `q must be ${maxQueryLength} characters or fewer` })
    })
    .transform((value) => (value.length > 0 ? value : null))

  const modeShape: z.ZodRawShape =
    mode === 'cursor'
      ? { cursor: z.string().trim().min(1).optional() }
      : { offset: z.coerce.number().int().min(0).optional() }

  const shape: z.ZodRawShape = {
    limit: limitSchema.optional(),
    q: freeTextSchema.optional(),
    sort: sortSchema.optional(),
    ...modeShape,
    ...filterShape,
  }

  const knownKeys = new Set(Object.keys(shape))
  const filterKeys = new Set(Object.keys(filterShape))
  const strict = options.strict ?? false

  const objectSchema = strict ? z.object(shape).strict() : z.object(shape).loose()

  return objectSchema.transform((raw): ListQuery<ListFilters, string> => {
    const record = raw as ListQueryWireValue
    const filters: ListFilters = {}
    const unknownKeys: string[] = []

    // `strict: true` already rejected any key outside `knownKeys` before this
    // transform ever runs, so `unknownKeys` naturally stays empty there.
    for (const key of Object.keys(record)) {
      if (filterKeys.has(key)) filters[key] = record[key]
      else if (!knownKeys.has(key)) unknownKeys.push(key)
    }

    const { cursor, limit, offset, q, sort } = record
    const resolved = {
      filters,
      limit: limit ?? defaultLimit,
      q: q ?? null,
      sort: sort ?? defaultSort,
      unknownKeys: unknownKeys.sort((left, right) => left.localeCompare(right)),
    }

    return mode === 'cursor'
      ? { ...resolved, cursor: cursor ?? null, mode: 'cursor' }
      : { ...resolved, mode: 'offset', offset: offset ?? 0 }
  })
}

/**
 * Builds the strict list-query schema for one route.
 *
 * @example
 * ```ts
 * const schema = listQuerySchema({
 *   sortable: ['name', 'updatedAt'],
 *   filters: z.object({ status: z.enum(['open', 'closed']).optional() }),
 *   maxLimit: 100,
 * })
 * schema.parse({ limit: '500', sort: 'name:asc' }) // limit clamped to 100
 * schema.parse({ pge: '2' }).unknownKeys // ['pge'] — tolerated by default
 * listQuerySchema({ ...options, strict: true }).safeParse({ pge: '2' }).success // false — opt-in
 * ```
 */
export function listQuerySchema<
  const TSortable extends readonly string[],
  TFilters extends z.ZodObject = z.ZodObject<Record<string, never>>,
>(
  options: ListQuerySchemaOptions<TSortable, TFilters, 'offset'> & { mode?: 'offset' },
): z.ZodType<OffsetListQuery<z.output<TFilters>, TSortable[number]>, unknown>
export function listQuerySchema<
  const TSortable extends readonly string[],
  TFilters extends z.ZodObject = z.ZodObject<Record<string, never>>,
>(
  options: ListQuerySchemaOptions<TSortable, TFilters, 'cursor'> & { mode: 'cursor' },
): z.ZodType<CursorListQuery<z.output<TFilters>, TSortable[number]>, unknown>
export function listQuerySchema(
  options: ListQuerySchemaOptions<readonly string[], z.ZodObject, ListQueryMode>,
): z.ZodType<ListQuery<ListFilters, string>, unknown> {
  return buildListQuerySchema(options)
}
