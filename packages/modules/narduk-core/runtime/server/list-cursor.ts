/**
 * Keyset cursors for cursor-mode list routes (narduk-libs#987).
 *
 * `parseListQuery(event, { mode: 'cursor' })` accepts a `cursor` string and
 * `listResponse` takes a `nextCursor` string, but nothing here built that
 * string, read it back or turned it into a `WHERE`. Every cursor route wrote
 * its own, and the hand-rolled copies drifted into the tie bug of #941 and
 * #974: a seek on the timestamp alone skips rows that share it across a page
 * boundary. This module is the one codec and the one seek predicate.
 *
 * - `encodeListCursor(scope, position)` renders an opaque, versioned base64url
 *   cursor bound to the route's endpoint and sort, and to any `bind` values
 *   (hashed, never readable back out of the cursor).
 * - `decodeListCursor` / `readListCursor` read it back and refuse a stale
 *   version, another endpoint, sort or `bind`, the wrong arity, an oversized
 *   or malformed cursor and a repeated `?cursor=` with one stable
 *   `400 cursor_invalid`.
 * - `keysetAfter(columns, position, dir)` is the tie-safe seek:
 *   `(a > ?) OR (a = ? AND b > ?) ...`. The last column must be unique (an id)
 *   for a page boundary to be exact. Every position value is bound as a
 *   parameter, never interpolated.
 *
 * A cursor is not signed. It is safe unsigned when the route re-derives
 * authorization on every request, so the cursor can only move a caller
 * within rows it may already read. `bind` stops a cursor minted for one
 * account, farm or filter being replayed under another.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/server/list-cursor`.
 * It is not under `server/utils`, so it adds no auto-imported names to
 * consuming apps (acre-oracle already declares its own `readCursor`).
 */

import { and, eq, gt, lt, or } from 'drizzle-orm'
import { createError, getQuery } from 'h3'

import type { Column, SQL } from 'drizzle-orm'
import type { H3Event } from 'h3'

/** Bumped whenever the payload shape changes; older cursors are refused once. */
export const LIST_CURSOR_VERSION = 1

/** The longest cursor string accepted, in characters. */
export const LIST_CURSOR_MAX_LENGTH = 2048

/** One component of a keyset position: a column value of the last row. */
export type ListCursorValue = number | string

/** What a cursor is bound to. A cursor read under any other scope is refused. */
export interface ListCursorScope {
  /**
   * Values the cursor must not outlive, such as the account or farm id and any
   * filter that changes the row set. They are hashed into the cursor, so they
   * cannot be read back out of it.
   */
  bind?: readonly string[]
  /** A stable name for the route, such as `'farms.fields'`. */
  endpoint: string
  /** The sort the position was taken under, such as `'createdAt:desc'`. */
  sort: string
}

export interface ReadListCursorOptions<TPosition extends readonly ListCursorValue[]> {
  /** How many values the position must carry: one per seek column. */
  arity: number
  /** Query parameter to read. Defaults to `'cursor'`. */
  param?: string
  /** Extra shape check of the decoded position, such as "the last value is a uuid". */
  validate?: (position: readonly ListCursorValue[]) => position is TPosition
}

/** Why a cursor was refused. Carried in the 400's `data.reason`. */
export type ListCursorInvalidReason =
  'arity' | 'binding' | 'malformed' | 'repeated' | 'too_long' | 'version'

/** Stable `data` payload carried by every cursor 400. */
export interface ListCursorErrorPayload {
  code: 'cursor_invalid'
  reason: ListCursorInvalidReason
}

interface ListCursorPayload {
  /** Hash of endpoint, sort and bind. */
  h: string
  /** Position. */
  p: ListCursorValue[]
  /** Version. */
  v: number
}

function cursorInvalid(reason: ListCursorInvalidReason): Error {
  const data: ListCursorErrorPayload = { code: 'cursor_invalid', reason }
  return createError({
    data,
    message: 'Invalid list cursor. Restart from the first page.',
    statusCode: 400,
    statusMessage: 'Bad Request',
  })
}

function encodeBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): string | undefined {
  if (!/^[\w-]*$/u.test(value) || value.length % 4 === 1) return undefined
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

async function scopeHash(scope: ListCursorScope): Promise<string> {
  const material = JSON.stringify([scope.endpoint, scope.sort, scope.bind ?? []])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  let binary = ''
  for (const byte of new Uint8Array(digest).subarray(0, 16)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function isCursorValue(value: unknown): value is ListCursorValue {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Renders the cursor for the page after the row whose seek-column values are
 * `position`. Pass it to `listResponse` as `nextCursor`.
 */
export async function encodeListCursor(
  scope: ListCursorScope,
  position: readonly ListCursorValue[],
): Promise<string> {
  if (position.length === 0) throw new TypeError('encodeListCursor: position must not be empty.')
  if (!position.every(isCursorValue)) {
    throw new TypeError('encodeListCursor: position values must be strings or finite numbers.')
  }

  const payload: ListCursorPayload = {
    h: await scopeHash(scope),
    p: [...position],
    v: LIST_CURSOR_VERSION,
  }
  const cursor = encodeBase64Url(JSON.stringify(payload))
  if (cursor.length > LIST_CURSOR_MAX_LENGTH) {
    throw new RangeError(
      `encodeListCursor: the cursor is ${cursor.length} characters, over ` +
        `LIST_CURSOR_MAX_LENGTH (${LIST_CURSOR_MAX_LENGTH}). Seek on shorter columns.`,
    )
  }
  return cursor
}

/**
 * Reads a cursor string back into its position under `scope`. `undefined` or
 * an empty string means "first page" and answers `undefined`.
 *
 * @throws a 400 `H3Error` whose `data` is a {@link ListCursorErrorPayload}.
 */
export async function decodeListCursor<
  TPosition extends readonly ListCursorValue[] = ListCursorValue[],
>(
  cursor: string | undefined,
  scope: ListCursorScope,
  options: Omit<ReadListCursorOptions<TPosition>, 'param'>,
): Promise<TPosition | undefined> {
  if (cursor === undefined || cursor === '') return undefined
  if (cursor.length > LIST_CURSOR_MAX_LENGTH) throw cursorInvalid('too_long')

  const json = decodeBase64Url(cursor)
  if (json === undefined) throw cursorInvalid('malformed')

  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    throw cursorInvalid('malformed')
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw cursorInvalid('malformed')
  }

  const { h, p, v } = payload as Partial<ListCursorPayload>
  if (v !== LIST_CURSOR_VERSION) throw cursorInvalid('version')
  if (typeof h !== 'string' || !Array.isArray(p) || !p.every(isCursorValue)) {
    throw cursorInvalid('malformed')
  }
  if (h !== (await scopeHash(scope))) throw cursorInvalid('binding')
  if (p.length !== options.arity) throw cursorInvalid('arity')
  if (options.validate && !options.validate(p)) throw cursorInvalid('malformed')

  return p as unknown as TPosition
}

/**
 * Reads `?cursor=` (or `options.param`) from the request and decodes it under
 * `scope`. No parameter, or an empty one, answers `undefined` (first page).
 *
 * @throws a 400 `H3Error` whose `data` is a {@link ListCursorErrorPayload}; a
 * repeated parameter is refused rather than guessed at.
 */
export async function readListCursor<
  TPosition extends readonly ListCursorValue[] = ListCursorValue[],
>(
  event: H3Event,
  scope: ListCursorScope,
  options: ReadListCursorOptions<TPosition>,
): Promise<TPosition | undefined> {
  const raw: unknown = getQuery(event)[options.param ?? 'cursor']
  if (Array.isArray(raw)) throw cursorInvalid('repeated')
  if (raw !== undefined && typeof raw !== 'string') throw cursorInvalid('malformed')
  return decodeListCursor(raw?.trim(), scope, options)
}

/**
 * The tie-safe seek predicate for the page after `position`, ordered by
 * `columns` in `dir`: `(a > ?) OR (a = ? AND b > ?) ...` (`<` for `'desc'`).
 * Order the query by the same columns in the same direction, and make the
 * last column unique so rows that share every earlier value are not skipped.
 */
export function keysetAfter(
  columns: readonly [Column, ...Column[]],
  position: readonly ListCursorValue[],
  dir: 'asc' | 'desc',
): SQL {
  if (position.length !== columns.length) {
    throw new RangeError(
      `keysetAfter: ${columns.length} column(s) but a position of ${position.length} value(s).`,
    )
  }

  const past = dir === 'asc' ? gt : lt
  const branches = columns.map((column, index) => {
    const ties = columns.slice(0, index).map((earlier, at) => eq(earlier, position[at]))
    return and(...ties, past(column, position[index]))
  })

  return (branches.length === 1 ? branches[0] : or(...branches)) as SQL
}
