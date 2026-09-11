/**
 * List-route helpers: parse one query, answer in one shape.
 *
 * `parseListQuery` validates an h3 event's query string through the
 * narduk-platform list-query contract and throws a 400 (never a 500) naming the
 * offending keys; `listResponse` renders the matching `ListResponse<T>`.
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
  LIST_QUERY_STATEMENT_CEILING,
  type ListQuerySchemaOptions,
  type OffsetListQuery,
  type OffsetListResponse,
} from '@narduk-enterprises/narduk-platform/list-query'
import { createError, getQuery } from 'h3'

import type { H3Event } from 'h3'
import type { z } from 'zod'

export { LIST_QUERY_STATEMENT_CEILING }

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

  return parsed.data
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
