import { z } from 'zod'
import { logRecordSchema } from './schema.js'
import type { Logger } from './types.js'

const batchSchema = z
  .object({ schemaVersion: z.literal(1), records: z.array(logRecordSchema).min(1).max(10) })
  .strict()
const MAX_BODY = 64 * 1024

export interface ClientIngestionOptions {
  logger: Logger
  mode?: 'authenticated' | 'anonymous'
  allowedOrigins?: readonly string[]
  allowedDataFields?: readonly string[]
  authorize: () => boolean | Promise<boolean>
  rateLimit: () => boolean | Promise<boolean>
}

async function readLimitedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new RangeError('Too large')
  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError('Empty body')
  const parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY) throw new RangeError('Too large')
      parts.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}

/** App code supplies its own authorization and distributed rate limiter; neither is inferred. */
export async function receiveClientLogs(
  request: Request,
  options: ClientIngestionOptions,
): Promise<Response> {
  const reply = (status: number) =>
    new Response(null, { status, headers: { 'cache-control': 'no-store' } })
  if (request.method !== 'POST') return reply(405)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return reply(415)
  const origin = request.headers.get('origin')
  const sameOrigin = new URL(request.url).origin
  if (origin && !(options.allowedOrigins ?? [sameOrigin]).includes(origin)) return reply(403)
  if (options.mode === 'anonymous') {
    if (!origin || !options.allowedOrigins?.length || !options.allowedOrigins.includes(origin))
      return reply(403)
  } else if (!(await options.authorize())) return reply(401)
  if (!(await options.rateLimit())) return reply(429)
  let payload: unknown
  try {
    payload = await readLimitedJson(request)
  } catch (error) {
    return reply(error instanceof RangeError ? 413 : 400)
  }
  const result = batchSchema.safeParse(payload)
  if (!result.success) return reply(400)
  const log = options.logger.withContext({ source: 'client' })
  for (const record of result.data.records) {
    const fields = Object.fromEntries(
      Object.entries(record.data ?? {}).filter(([key]) => options.allowedDataFields?.includes(key)),
    )
    // Identity, timestamp, source, and correlation of this ingest are assigned by the server.
    // Claimed client context is explicitly marked data, never trusted envelope fields.
    log[record.level](record.message, {
      ...fields,
      clientRuntime: record.runtime,
      clientRelease: record.release,
      clientRequestId: record.requestId,
      ...(record.error ? { error: record.error } : {}),
    })
  }
  return reply(202)
}
