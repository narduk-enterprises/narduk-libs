import { getTableColumns } from 'drizzle-orm'

import type { Table } from 'drizzle-orm'

/**
 * Bound parameters one statement may carry. D1 and Durable Object SQLite both
 * refuse more ("too many SQL variables"); `node:sqlite` and better-sqlite3 do
 * not enforce it, so a unit suite on either can pass a statement workerd will
 * refuse. Budget with the options below instead of trusting a local run.
 */
export const D1_MAX_BOUND_PARAMETERS_PER_QUERY = 100
export const D1_DEFAULT_BOUND_PARAMETER_CHUNK_SIZE = 75
export const D1_MAX_SQL_STATEMENT_BYTES = 100_000
export const D1_MAX_ROW_BYTES = 2_000_000

/**
 * How a list of values is split so every statement stays under the bound
 * parameter limit. The budget counts parameters, not values:
 * `floor((maxBoundParameters - reservedParameters) / parametersPerValue)`
 * values fit in one statement.
 */
export interface D1BoundValueChunkOptions {
  /** Values per chunk. Defaults to 75, capped at the budget; above the budget it throws. */
  chunkSize?: number
  /** Ceiling for the whole statement. Defaults to, and may not exceed, 100. */
  maxBoundParameters?: number
  /**
   * Parameters each value binds: 1 for a bare `IN (?)`, 2 for a composite
   * `(a, b) IN ((?, ?))` key, the column count for a multi-row `INSERT` row
   * (see `chunkD1Rows`). Defaults to 1.
   */
  parametersPerValue?: number
  /** Parameters the statement binds outside the list, e.g. a tenant id. Defaults to 0. */
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

function positiveIntegerOption(optionName: string, value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(formatOptionError(optionName, value, 'expected a positive integer'))
  }
  return value
}

function resolveD1ChunkSize(options: D1BoundValueChunkOptions = {}) {
  const maxBoundParameters = options.maxBoundParameters ?? D1_MAX_BOUND_PARAMETERS_PER_QUERY

  if (!Number.isInteger(maxBoundParameters) || maxBoundParameters < 1) {
    throw new Error(
      formatOptionError('maxBoundParameters', maxBoundParameters, 'expected a positive integer'),
    )
  }

  if (maxBoundParameters > D1_MAX_BOUND_PARAMETERS_PER_QUERY) {
    throw new Error(
      formatOptionError(
        'maxBoundParameters',
        maxBoundParameters,
        `must not exceed ${D1_MAX_BOUND_PARAMETERS_PER_QUERY}`,
      ),
    )
  }

  const parametersPerValue = positiveIntegerOption(
    'parametersPerValue',
    options.parametersPerValue ?? 1,
  )
  const reservedParameters = options.reservedParameters ?? 0
  if (!Number.isInteger(reservedParameters) || reservedParameters < 0) {
    throw new Error(
      formatOptionError('reservedParameters', reservedParameters, 'expected a whole number'),
    )
  }

  const budget = Math.floor((maxBoundParameters - reservedParameters) / parametersPerValue)
  if (budget < 1) {
    throw new Error(
      `Invalid D1 chunk budget: ${reservedParameters} reserved + ${parametersPerValue} per value exceeds ${maxBoundParameters} bound parameters.`,
    )
  }

  const chunkSize = positiveIntegerOption(
    'chunkSize',
    options.chunkSize ?? Math.min(D1_DEFAULT_BOUND_PARAMETER_CHUNK_SIZE, budget),
  )

  if (chunkSize > budget) {
    throw new Error(
      formatOptionError(
        'chunkSize',
        chunkSize,
        `must not exceed ${budget} (${maxBoundParameters} bound parameters, ${reservedParameters} reserved, ${parametersPerValue} per value)`,
      ),
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

/** Split `values` so each chunk's statement stays within the bound parameter budget. */
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
  maxBoundParameters?: number
  /** Parameters the statement binds outside the rows. Defaults to 0. */
  reservedParameters?: number
}

/**
 * Split rows for a multi-row `INSERT`, which binds one parameter per column
 * per row. Pass the Drizzle table, so adding a column narrows the chunk rather
 * than pushing a statement past the limit, or the column count when the
 * statement is not built from one table.
 */
export function chunkD1Rows<TRow>(
  rows: readonly TRow[],
  tableOrColumnCount: Table | number,
  options: D1RowChunkOptions = {},
): TRow[][] {
  const parametersPerValue =
    typeof tableOrColumnCount === 'number'
      ? tableOrColumnCount
      : Object.keys(getTableColumns(tableOrColumnCount)).length
  const maxBoundParameters = options.maxBoundParameters ?? D1_MAX_BOUND_PARAMETERS_PER_QUERY
  const reservedParameters = options.reservedParameters ?? 0
  // A row chunk fills the whole budget: the width already sets the headroom.
  const budget = Math.floor((maxBoundParameters - reservedParameters) / parametersPerValue)
  return chunkD1BoundValues(rows, {
    chunkSize: Math.max(1, budget),
    maxBoundParameters,
    parametersPerValue,
    reservedParameters,
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
