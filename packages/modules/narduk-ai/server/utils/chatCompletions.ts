import { createError } from 'h3'

import { parseXaiError } from './xai'

/*
 * A provider-neutral client for OpenAI-compatible `POST {base}/chat/completions`
 * (narduk-libs#985). xAI, OpenAI and Groq all take the same request, so the
 * provider is a base URL. `grokChat` stays as it is; this is for callers that
 * need options it never had: max tokens, JSON mode, a timeout, a 5xx retry and
 * usage in the result.
 *
 * Errors are H3 errors with a sanitized message (`parseXaiError`'s provider
 * message or a fixed fallback). The raw upstream body is never put in the
 * message, because a provider error can echo the prompt or account details.
 */

export interface ChatCompletionMessage {
  content: string
  role: 'system' | 'user' | 'assistant'
}

export interface ChatCompletionOptions {
  apiKey: string
  /** Default `https://api.x.ai/v1`; e.g. `https://api.openai.com/v1`, `https://api.groq.com/openai/v1`. */
  baseUrl?: string
  /** `response_format: { type: 'json_object' }`. */
  json?: boolean
  maxTokens?: number
  model: string
  /** Extra attempts after a 5xx, a network error or a timeout. Default 1. */
  retries?: number
  signal?: AbortSignal
  temperature?: number
  /** Per attempt. Default 30 000 ms. */
  timeoutMs?: number
}

export interface ChatCompletionUsage {
  completionTokens: number
  promptTokens: number
  totalTokens: number
}

export interface ChatCompletionResult {
  content: string
  model: string
  usage: ChatCompletionUsage | null
}

export const DEFAULT_CHAT_COMPLETION_BASE_URL = 'https://api.x.ai/v1'
export const DEFAULT_CHAT_COMPLETION_TIMEOUT_MS = 30_000
const FALLBACK_ERROR_MESSAGE = 'Failed to reach the chat completion provider.'

function chatCompletionsUrl(baseUrl: string): string {
  // A loop, not /\/+$/: that pattern backtracks polynomially on a long run of
  // slashes, and the base URL can come from configuration.
  let end = baseUrl.length
  while (end > 0 && baseUrl[end - 1] === '/') end -= 1
  return `${baseUrl.slice(0, end)}/chat/completions`
}

function readUsage(value: unknown): ChatCompletionUsage | null {
  if (!value || typeof value !== 'object') return null
  const usage = value as Record<string, unknown>
  const number = (key: string) => (typeof usage[key] === 'number' ? usage[key] : null)
  const prompt = number('prompt_tokens')
  const completion = number('completion_tokens')
  const total = number('total_tokens')
  if (prompt === null && completion === null && total === null) return null
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
  }
}

class RetryableFailure extends Error {
  constructor(readonly failure: unknown) {
    super('retryable')
  }
}

async function attempt(
  url: string,
  init: RequestInit,
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHAT_COMPLETION_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (options.signal?.aborted) throw error
      const timedOut = controller.signal.aborted
      throw new RetryableFailure(
        createError({
          statusCode: timedOut ? 504 : 502,
          message: timedOut
            ? `The chat completion provider did not answer within ${timeoutMs} ms.`
            : FALLBACK_ERROR_MESSAGE,
        }),
      )
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const error = createError({
        statusCode: response.status,
        message: parseXaiError(body) ?? FALLBACK_ERROR_MESSAGE,
      })
      if (response.status >= 500) throw new RetryableFailure(error)
      throw error
    }
    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>
      model?: unknown
      usage?: unknown
    } | null
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw createError({
        statusCode: 502,
        message: 'The chat completion provider returned no message content.',
      })
    }
    return {
      content: content.trim(),
      model: typeof payload?.model === 'string' ? payload.model : options.model,
      usage: readUsage(payload?.usage),
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** One chat completion. Retries a 5xx, network error or timeout `retries` times (default 1). */
export async function chatCompletion(
  messages: ChatCompletionMessage[],
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const url = chatCompletionsUrl(options.baseUrl ?? DEFAULT_CHAT_COMPLETION_BASE_URL)
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  }
  const retries = Math.max(0, options.retries ?? 1)
  for (let tries = 0; ; tries += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retries are sequential by design: each attempt runs only after the previous one failed
      return await attempt(url, init, options)
    } catch (error) {
      if (!(error instanceof RetryableFailure)) throw error
      if (tries >= retries) throw error.failure
    }
  }
}

/**
 * Parse model output as JSON, tolerating a surrounding ```json fence. Throws a
 * 502 H3 error (without the output in the message) when it is not JSON.
 */
export function parseChatJson(content: string): unknown {
  const trimmed = content.trim()
  const fenced = trimmed.length >= 6 && trimmed.startsWith('```') && trimmed.endsWith('```')
  const text = fenced ? trimmed.slice(3, -3).replace(/^json/iu, '') : trimmed
  try {
    return JSON.parse(text)
  } catch {
    throw createError({
      statusCode: 502,
      message: 'The chat completion provider returned invalid JSON.',
    })
  }
}

/**
 * A JSON-mode completion, parsed and handed to `parse` (a zod schema's
 * `.parse` fits). Whatever `parse` throws propagates unchanged.
 */
export async function chatCompletionJson<T>(
  messages: ChatCompletionMessage[],
  parse: (value: unknown) => T,
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult & { data: T }> {
  const result = await chatCompletion(messages, { ...options, json: true })
  return { ...result, data: parse(parseChatJson(result.content)) }
}
