/**
 * List-route helpers: parse one query, answer in one shape.
 *
 * `parseListQuery` validates an h3 event's query string through the
 * narduk-platform list-query contract and throws a 400 (never a 500) naming the
 * offending keys; `listResponse` renders the matching `ListResponse<T>`.
 *
 * An unknown query key is tolerated for one release rather than rejected
 * (Logan, 2026-09-11 — see `.changeset/list-query-tolerate-unknown-keys.md`):
 * the request still succeeds with the known keys parsed exactly as before,
 * and `parseListQuery` logs one structured `warn` per request through
 * narduk-logging — `useLogger(event)`, not a dev-only `console.warn`, so a
 * fleet operator can find it in production — naming every ignored key. Pass
 * `strict: true` to reject an unknown key with a 400 today; the next major
 * flips that default.
 *
 * A list route may issue at most {@link LIST_QUERY_STATEMENT_CEILING}
 * statements (one page `SELECT`, plus one `COUNT(*)` when `total` is a
 * number). `total: null` is the one-statement path.
 *
 * See narduk-libs `docs/plans/components-library-plan.md` §2 item 10.
 */
import {
  type CursorListQuery,
  type CursorListResponse,
  formatListSort,
  type ListFilters,
  type ListQuery,
  type ListQueryMode,
  listQuerySchema,
  type ListQuerySchemaOptions,
  type OffsetListQuery,
  type OffsetListResponse,
} from '@narduk-enterprises/narduk-platform/list-query'
import { createError, getQuery } from 'h3'

import { useLogger } from './logger'

import type { H3Event } from 'h3'
import type { z } from 'zod'

export { LIST_QUERY_STATEMENT_CEILING } from '@narduk-enterprises/narduk-platform/list-query'

/** Stable `data` payload carried by every list-query 400. */
export interface ListQueryErrorPayload {
  code: 'invalid_list_query'
  /** Every query field that failed, dotted, sorted and de-duplicated. */
  fields: string[]
  issues: ListQueryErrorIssue[]
  /** The subset of `fields` the route does not accept at all. */
  unknownKeys: string[]
}

export interface ListQueryErrorIssue {
  code: string
  field: string
  message: string
}

const ROOT_FIELD = '(query)'

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

/** Turns a zod failure into the machine-readable payload consumers can act on. */
export function toListQueryErrorPayload(error: z.ZodError): ListQueryErrorPayload {
  const issues: ListQueryErrorIssue[] = []
  const unknownKeys: string[] = []

  for (const issue of error.issues) {
    const prefix = issue.path.map((segment) => String(segment))
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const field = [...prefix, key].join('.')
        unknownKeys.push(field)
        issues.push({ code: issue.code, field, message: `Unknown query key '${field}'.` })
      }
      continue
    }

    issues.push({
      code: issue.code,
      field: prefix.join('.') || ROOT_FIELD,
      message: issue.message,
    })
  }

  return {
    code: 'invalid_list_query',
    fields: unique(issues.map((issue) => issue.field)),
    issues,
    unknownKeys: unique(unknownKeys),
  }
}

/**
 * Parses `event`'s query string through the list-query contract.
 *
 * @throws a 400 `H3Error` whose `data` is a {@link ListQueryErrorPayload}. A
 * malformed query is always the caller's fault, so it never becomes a 500.
 */
export function parseListQuery<
  const TSortable extends readonly string[],
  TFilters extends z.ZodObject = z.ZodObject<Record<string, never>>,
>(
  event: H3Event,
  options: ListQuerySchemaOptions<TSortable, TFilters, 'offset'> & { mode?: 'offset' },
): OffsetListQuery<z.output<TFilters>, TSortable[number]>
export function parseListQuery<
  const TSortable extends readonly string[],
  TFilters extends z.ZodObject = z.ZodObject<Record<string, never>>,
>(
  event: H3Event,
  options: ListQuerySchemaOptions<TSortable, TFilters, 'cursor'> & { mode: 'cursor' },
): CursorListQuery<z.output<TFilters>, TSortable[number]>
export function parseListQuery(
  event: H3Event,
  options: ListQuerySchemaOptions<readonly string[], z.ZodObject, ListQueryMode>,
): ListQuery<ListFilters, string> {
  const schema =
    options.mode === 'cursor'
      ? listQuerySchema({ ...options, mode: 'cursor' })
      : listQuerySchema({ ...options, mode: 'offset' })

  const parsed = schema.safeParse(getQuery(event))
  if (!parsed.success) {
    const data = toListQueryErrorPayload(parsed.error)
    throw createError({
      data,
      message: `Invalid list query: ${data.fields.join(', ') || ROOT_FIELD}.`,
      statusCode: 400,
      statusMessage: 'Bad Request',
    })
  }

  warnUnknownListQueryKeys(event, parsed.data.unknownKeys)
  return parsed.data
}

/**
 * Logs one structured warning per request naming every list-query key this
 * route does not declare. `unknownKeys` is non-empty only when the schema
 * tolerated them — the `strict` option was not set — since `strict: true`
 * rejects them with a 400 before `parseListQuery` gets here. See
 * `.changeset/list-query-tolerate-unknown-keys.md`.
 */
function warnUnknownListQueryKeys(event: H3Event, unknownKeys: readonly string[]): void {
  if (unknownKeys.length === 0) return

  // Tolerating an unknown key must never depend on logging succeeding: a
  // logger failure (of any kind, in any consumer) reports nothing rather
  // than turning a tolerated request into a 500.
  try {
    useLogger(event)
      .child('ListQuery')
      .warn(
        `Ignoring unknown list-query key(s): ${unknownKeys.join(', ')}. They will be rejected ` +
          `with a 400 once strict mode is the default in the next major version; pass ` +
          `strict: true to opt into that behaviour now.`,
        { code: 'list_query_unknown_keys', unknownKeys: [...unknownKeys] },
      )
  } catch {
    /* See comment above — a warning is best-effort. */
  }
}

export interface OffsetListResponseOptions<TFilters, TKey extends string> {
  query: OffsetListQuery<TFilters, TKey>
  /** `null` (the default) when the route deliberately does not count. */
  total?: number | null
}

export interface CursorListResponseOptions<TFilters, TKey extends string> {
  /** `null` (the default) when this page exhausted the collection. */
  nextCursor?: string | null
  query: CursorListQuery<TFilters, TKey>
  total?: number | null
}

/**
 * Wraps one page of rows in the contract's response shape, echoing the query
 * back so a client can page without re-deriving it.
 */
export function listResponse<TItem, TFilters, TKey extends string>(
  items: TItem[],
  options: OffsetListResponseOptions<TFilters, TKey>,
): OffsetListResponse<TItem>
export function listResponse<TItem, TFilters, TKey extends string>(
  items: TItem[],
  options: CursorListResponseOptions<TFilters, TKey>,
): CursorListResponse<TItem>
export function listResponse<TItem>(
  items: TItem[],
  options: {
    nextCursor?: string | null
    query: ListQuery<ListFilters, string>
    total?: number | null
  },
): CursorListResponse<TItem> | OffsetListResponse<TItem> {
  const { query } = options
  const base = {
    items,
    limit: query.limit,
    q: query.q,
    sort: formatListSort(query.sort),
    total: options.total ?? null,
  }

  return query.mode === 'cursor'
    ? { ...base, nextCursor: options.nextCursor ?? null }
    : { ...base, offset: query.offset ?? 0 }
}
