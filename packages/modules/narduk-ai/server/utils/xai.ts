import { createError } from 'h3'

import { logAiCallFailure, statusCodeOf } from './aiCallLog'

import type { AiCallFields, AiCallLogger } from './aiCallLog'

export interface GrokChatMessage {
  content: string
  role: 'system' | 'user' | 'assistant'
}

/** Optional trailing argument of the xAI helpers; omitting it changes nothing. */
export interface XaiCallOptions {
  /** Receives the call record (see `aiCallLog.ts`). Default: no records. */
  logger?: AiCallLogger
}

const XAI_PROVIDER = 'api.x.ai'

export interface XaiModel {
  created?: number
  id: string
  object: string
  owned_by?: string
}

export function parseXaiError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string }
      message?: string
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error
    }
    if (parsed.error && typeof parsed.error === 'object' && parsed.error.message?.trim()) {
      return parsed.error.message
    }
    if (parsed.message?.trim()) {
      return parsed.message
    }
    return null
  } catch {
    return null
  }
}

function createXaiRequest(
  apiKey: string,
  messages: GrokChatMessage[],
  model: string,
  stream = false,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      store: false,
      ...(stream ? { stream: true } : {}),
    }),
  }
}

async function throwXaiResponseError(response: Response): Promise<never> {
  const body = await response.text()
  throw createError({
    statusCode: response.status,
    message: parseXaiError(body) ?? 'Failed to reach xAI.',
  })
}

/**
 * Run one xAI request and record it: a fetch that rejects is a `network` (or
 * `timeout`) failure, a non-2xx is `http_status`. Only `onResponse` sees the
 * body, and whatever it throws is recorded as `invalid_response` unless it
 * carries a status of its own.
 */
async function xaiCall<T>(
  url: string,
  init: RequestInit,
  fields: AiCallFields,
  options: XaiCallOptions,
  onResponse: (response: Response) => Promise<T>,
  completedMessage = 'AI provider call completed',
): Promise<T> {
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    logAiCallFailure(options.logger, fields, {
      durationMs: elapsed(),
      reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
    })
    throw error
  }
  if (!response.ok) {
    logAiCallFailure(options.logger, fields, {
      durationMs: elapsed(),
      reason: 'http_status',
      statusCode: response.status,
    })
  }
  try {
    const result = await onResponse(response)
    options.logger?.info(completedMessage, {
      ...fields,
      statusCode: response.status,
      durationMs: elapsed(),
    })
    return result
  } catch (error) {
    if (response.ok) {
      logAiCallFailure(options.logger, fields, {
        durationMs: elapsed(),
        reason: 'invalid_response',
        statusCode: statusCodeOf(error),
      })
    }
    throw error
  }
}

export async function grokChat(
  apiKey: string,
  messages: GrokChatMessage[],
  model: string,
  options: XaiCallOptions = {},
): Promise<string> {
  return xaiCall(
    'https://api.x.ai/v1/chat/completions',
    createXaiRequest(apiKey, messages, model),
    { provider: XAI_PROVIDER, operation: 'chat.completions', model },
    options,
    async (response) => {
      if (!response.ok) {
        await throwXaiResponseError(response)
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
      }
      const content = payload.choices?.[0]?.message?.content
      return typeof content === 'string' ? content.trim() : ''
    },
  )
}

export async function grokChatStream(
  apiKey: string,
  messages: GrokChatMessage[],
  model: string,
  options: XaiCallOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  return xaiCall(
    'https://api.x.ai/v1/chat/completions',
    createXaiRequest(apiKey, messages, model, true),
    { provider: XAI_PROVIDER, operation: 'chat.completions.stream', model },
    options,
    async (response) => {
      if (!response.ok) {
        await throwXaiResponseError(response)
      }
      if (!response.body) {
        throw createError({ statusCode: 502, message: 'xAI returned an empty stream.' })
      }

      return response.body.pipeThrough(createXaiSseStreamParser())
    },
    // Time to headers: the stream itself is consumed after this returns.
    'AI provider stream opened',
  )
}

export function createXaiSseStreamParser(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  function enqueueContent(line: string, controller: TransformStreamDefaultController<Uint8Array>) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return

    const payload = trimmed.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') return

    try {
      const data = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: unknown } }>
      }
      const content = data.choices?.[0]?.delta?.content
      if (typeof content === 'string' && content.length > 0) {
        controller.enqueue(encoder.encode(content))
      }
    } catch {
      // Ignore malformed SSE records and continue the stream.
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        enqueueContent(line, controller)
      }
    },
    flush(controller) {
      buffer += decoder.decode()
      if (buffer) {
        enqueueContent(buffer, controller)
      }
    },
  })
}

// Listing models is a small metadata read, not a generation, so it gets a
// short bound: the admin model route awaits it, and a stalled xAI must not hold
// that request open. A timeout rejects with a `TimeoutError` and propagates
// exactly as a network failure does today.
const XAI_LIST_MODELS_TIMEOUT_MS = 10_000

export async function grokListModels(
  apiKey: string,
  options: XaiCallOptions = {},
): Promise<XaiModel[]> {
  return xaiCall(
    'https://api.x.ai/v1/models',
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(XAI_LIST_MODELS_TIMEOUT_MS),
    },
    { provider: XAI_PROVIDER, operation: 'models.list' },
    options,
    async (response) => {
      if (!response.ok) {
        await response.text()
        throw createError({ statusCode: response.status, message: 'Failed to list xAI models.' })
      }

      const data = (await response.json()) as { data?: XaiModel[] }
      return Array.isArray(data.data) ? data.data : []
    },
  )
}
