/**
 * Bound-parameter chunking for D1 and Durable Object SQLite.
 *
 * Both allow at most {@link D1_MAX_BOUND_PARAMETERS_PER_QUERY} bound parameters
 * in one statement, and a statement over it fails at run time with
 * `too many SQL variables`. `node:sqlite` and better-sqlite3 do not enforce
 * that limit, so a unit suite on either passes a statement workerd refuses
 * (mybo-at-v2's track backfill bound 500 and failed every batch on preview).
 *
 * The helpers count **parameters, not values** (narduk-libs#988): a value may
 * bind more than one parameter (a composite key, or one row of a multi-row
 * `INSERT`), and a statement may bind fixed parameters beside the list (a
 * tenant id). The chunk size is derived from both, so adding a column narrows
 * the chunk instead of crossing the limit.
 */
import { getTableColumns } from 'drizzle-orm'

import type { Table } from 'drizzle-orm'

export const D1_MAX_BOUND_PARAMETERS_PER_QUERY = 100
export const D1_DEFAULT_BOUND_PARAMETER_CHUNK_SIZE = 75
export const D1_MAX_SQL_STATEMENT_BYTES = 100_000
export const D1_MAX_ROW_BYTES = 2_000_000

export interface D1BoundValueChunkOptions {
  /**
   * Values per chunk. Defaults to the smaller of
   * {@link D1_DEFAULT_BOUND_PARAMETER_CHUNK_SIZE} and what fits. Throws when
   * it does not fit once `parametersPerValue` and `reservedParameters` are
   * counted.
   */
  chunkSize?: number
  /** The statement's parameter ceiling. At most {@link D1_MAX_BOUND_PARAMETERS_PER_QUERY}. */
  maxBoundParameters?: number
  /**
   * Parameters each value binds. 1 for a bare `IN (?, ...)`, 2 for a
   * `(a, b)` composite key, the column count for a row of a multi-row
   * `INSERT`. Default 1.
   */
  parametersPerValue?: number
  /**
   * Parameters the statement binds outside the list, such as a tenant id or a
   * `WHERE` predicate beside the `IN`. Default 0.
   */
  reservedParameters?: number
}

export interface D1ChunkExecutionContext {
  chunkCount: number
  chunkIndex: number
}

export interface D1ChunkedQueryOptions extends D1BoundValueChunkOptions {
  label?: string
}

type D1ChunkRunner<TValue, TResult> = (
  chunk: readonly TValue[],
  context: D1ChunkExecutionContext,
) => Promise<TResult> | TResult

function formatOptionError(optionName: string, value: number, detail: string) {
  return `Invalid D1 ${optionName} ${value}: ${detail}.`
}

function requireInteger(optionName: string, value: number, minimum: number) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(
      formatOptionError(
        optionName,
        value,
        minimum === 0 ? 'expected a non-negative integer' : 'expected a positive integer',
      ),
    )
  }
}

function resolveD1ChunkSize(options: D1BoundValueChunkOptions = {}) {
  const maxBoundParameters = options.maxBoundParameters ?? D1_MAX_BOUND_PARAMETERS_PER_QUERY
  const parametersPerValue = options.parametersPerValue ?? 1
  const reservedParameters = options.reservedParameters ?? 0

  requireInteger('maxBoundParameters', maxBoundParameters, 1)

  if (maxBoundParameters > D1_MAX_BOUND_PARAMETERS_PER_QUERY) {
    throw new Error(
      formatOptionError(
        'maxBoundParameters',
        maxBoundParameters,
        `must not exceed ${D1_MAX_BOUND_PARAMETERS_PER_QUERY}`,
      ),
    )
  }

  requireInteger('parametersPerValue', parametersPerValue, 1)
  requireInteger('reservedParameters', reservedParameters, 0)

  if (reservedParameters >= maxBoundParameters) {
    throw new Error(
      formatOptionError(
        'reservedParameters',
        reservedParameters,
        `must be less than maxBoundParameters ${maxBoundParameters}`,
      ),
    )
  }

  const capacity = Math.floor((maxBoundParameters - reservedParameters) / parametersPerValue)
  if (capacity < 1) {
    throw new Error(
      formatOptionError(
        'parametersPerValue',
        parametersPerValue,
        `no value fits in ${maxBoundParameters - reservedParameters} parameters ` +
          `(${maxBoundParameters} minus ${reservedParameters} reserved)`,
      ),
    )
  }

  const chunkSize = options.chunkSize ?? Math.min(D1_DEFAULT_BOUND_PARAMETER_CHUNK_SIZE, capacity)

  requireInteger('chunkSize', chunkSize, 1)

  if (chunkSize > capacity) {
    const width =
      parametersPerValue === 1 && reservedParameters === 0
        ? ''
        : ` (${parametersPerValue} parameter(s) per value, ${reservedParameters} reserved, ` +
          `${maxBoundParameters} maximum)`
    throw new Error(
      formatOptionError('chunkSize', chunkSize, `must not exceed ${capacity}${width}`),
    )
  }

  return chunkSize
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function wrapD1ChunkError(
  error: unknown,
  options: D1ChunkedQueryOptions,
  context: D1ChunkExecutionContext,
) {
  const label = options.label ? `${options.label}: ` : ''
  const wrapped = new Error(
    `${label}D1 chunk ${context.chunkIndex + 1}/${context.chunkCount} failed: ${getErrorMessage(error)}`,
  ) as Error & { cause?: unknown }
  wrapped.cause = error
  return wrapped
}

/**
 * Splits `values` so no statement binds more than the limit. Each value
 * counts as `parametersPerValue` parameters, and `reservedParameters` are
 * set aside for the rest of the statement.
 *
 * @throws when the options are malformed, when one value cannot fit, or when
 * an explicit `chunkSize` would overrun: at call time, not at D1.
 */
export function chunkD1BoundValues<TValue>(
  values: readonly TValue[],
  options: D1BoundValueChunkOptions = {},
): TValue[][] {
  const chunkSize = resolveD1ChunkSize(options)
  const chunks: TValue[][] = []

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }

  return chunks
}

export interface D1RowChunkOptions {
  /** Rows per `INSERT`. Defaults to as many as fit (at most 75). */
  chunkSize?: number
  maxBoundParameters?: number
  /** Parameters the statement binds outside the `VALUES` list. Default 0. */
  reservedParameters?: number
}

/**
 * Splits rows for a multi-row `INSERT ... VALUES`, which binds one parameter
 * per column per row. Pass the Drizzle table, whose full column count is the
 * width (conservative: a row that omits a column can only make the chunk
 * smaller than necessary, never too big), or the column count itself.
 *
 * @example
 * ```ts
 * for (const chunk of chunkD1Rows(rows, fields)) {
 *   await db.insert(fields).values(chunk)
 * }
 * ```
 */
export function chunkD1Rows<TRow>(
  rows: readonly TRow[],
  tableOrColumnCount: number | Table,
  options: D1RowChunkOptions = {},
): TRow[][] {
  const parametersPerValue =
    typeof tableOrColumnCount === 'number'
      ? tableOrColumnCount
      : Object.keys(getTableColumns(tableOrColumnCount)).length

  return chunkD1BoundValues(rows, {
    chunkSize: options.chunkSize,
    maxBoundParameters: options.maxBoundParameters,
    parametersPerValue,
    reservedParameters: options.reservedParameters,
  })
}

async function runD1ChunksSequentially<TValue, TResult>(
  chunks: TValue[][],
  runChunk: D1ChunkRunner<TValue, TResult>,
  options: D1ChunkedQueryOptions,
): Promise<TResult[]> {
  const results: TResult[] = []

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const context = { chunkCount: chunks.length, chunkIndex }

    try {
      results.push(await runChunk(chunk, context))
    } catch (error) {
      throw wrapD1ChunkError(error, options, context)
    }
  }

  return results
}

export async function collectD1ChunkedRows<TValue, TRow>(
  values: readonly TValue[],
  queryChunk: D1ChunkRunner<TValue, readonly TRow[]>,
  options: D1ChunkedQueryOptions = {},
): Promise<TRow[]> {
  const chunks = chunkD1BoundValues(values, options)
  const rowChunks = await runD1ChunksSequentially(chunks, queryChunk, options)

  return rowChunks.flat()
}

export async function runD1Chunked<TValue, TResult>(
  values: readonly TValue[],
  runChunk: D1ChunkRunner<TValue, TResult>,
  options: D1ChunkedQueryOptions = {},
): Promise<TResult[]> {
  const chunks = chunkD1BoundValues(values, options)

  return runD1ChunksSequentially(chunks, runChunk, options)
}
