export const D1_MAX_BOUND_PARAMETERS_PER_QUERY = 100
export const D1_DEFAULT_BOUND_PARAMETER_CHUNK_SIZE = 75
export const D1_MAX_SQL_STATEMENT_BYTES = 100_000
export const D1_MAX_ROW_BYTES = 2_000_000

export interface D1BoundValueChunkOptions {
  chunkSize?: number
  maxBoundParameters?: number
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

  const chunkSize =
    options.chunkSize ?? Math.min(D1_DEFAULT_BOUND_PARAMETER_CHUNK_SIZE, maxBoundParameters)

  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(formatOptionError('chunkSize', chunkSize, 'expected a positive integer'))
  }

  if (chunkSize > maxBoundParameters) {
    throw new Error(
      formatOptionError('chunkSize', chunkSize, `must not exceed ${maxBoundParameters}`),
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
