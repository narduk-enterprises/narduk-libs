import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import { createEvent } from 'h3'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { aiProviderHost } from '../server/utils/aiCallLog'
import { chatCompletion } from '../server/utils/chatCompletions'
import { grokChat, grokChatStream, grokListModels } from '../server/utils/xai'

import type { AiCallLogger } from '../server/utils/aiCallLog'

/*
 * The provider clients write through an injected logger. The redaction cases
 * use narduk-core's real request bridge (and so narduk-logging's sanitizer)
 * with a capturing sink, exactly as an app's route would.
 */

const sink = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  write(record: Record<string, unknown>) {
    this.records.push(record)
  },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    nardukLogging: { sinks: [sink], level: 'debug', service: 'ai-test' },
  }),
}))

const SECRET_KEY = 'xai-synthetic-secret-key'
const PROMPT = 'synthetic private prompt about jane@example.com'
const MODEL = 'grok-3-mini'
const MESSAGES = [{ role: 'user' as const, content: PROMPT }]

function recordingLogger() {
  const calls: Array<{ data?: Record<string, unknown>; level: string; message: string }> = []
  const logger: AiCallLogger = {
    info: (message, data) => calls.push({ level: 'info', message, data }),
    warn: (message, data) => calls.push({ level: 'warn', message, data }),
    error: (message, data) => calls.push({ level: 'error', message, data }),
  }
  return { calls, logger }
}

function requestLogger() {
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.url = '/api/chat'
  return useLogger(createEvent(request, new ServerResponse(request))).child('AI')
}

function completion(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], ...extra }), {
    status: 200,
  })
}

beforeAll(async () => {
  // narduk-core resolves Nitro's runtime config through a dynamic import.
  await import('nitropack/runtime')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

afterEach(() => {
  sink.records.length = 0
  vi.unstubAllGlobals()
})

describe('aiProviderHost', () => {
  it('keeps only the host of a configured base URL', () => {
    expect(aiProviderHost('https://api.groq.com/openai/v1/chat/completions?key=x')).toBe(
      'api.groq.com',
    )
    expect(aiProviderHost('not a url')).toBe('unknown')
  })
})

describe('chatCompletion records', () => {
  it('writes one completion record with model, attempts, timing and usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        completion('answer', {
          model: 'grok-3-mini-2025',
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
      ),
    )
    const { calls, logger } = recordingLogger()

    await chatCompletion(MESSAGES, { apiKey: SECRET_KEY, model: MODEL, logger })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      level: 'info',
      message: 'AI provider call completed',
      data: {
        provider: 'api.x.ai',
        operation: 'chat.completions',
        model: MODEL,
        responseModel: 'grok-3-mini-2025',
        attempts: 1,
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      },
    })
    expect(typeof calls[0]?.data?.durationMs).toBe('number')
  })

  it('warns on a retried 5xx and records the final failure with its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response('{}', { status: 503 })),
    )
    const { calls, logger } = recordingLogger()

    await expect(
      chatCompletion(MESSAGES, { apiKey: SECRET_KEY, model: MODEL, logger, retries: 1 }),
    ).rejects.toMatchObject({ statusCode: 503 })

    expect(calls.map((call) => [call.level, call.message])).toEqual([
      ['warn', 'AI provider call retrying'],
      ['error', 'AI provider call failed'],
    ])
    expect(calls[0]?.data).toMatchObject({ attempt: 1, reason: 'http_status', statusCode: 503 })
    expect(calls[1]?.data).toMatchObject({ attempts: 2, reason: 'http_status', statusCode: 503 })
  })

  it('classifies a 4xx, missing content and a network failure', async () => {
    const { calls, logger } = recordingLogger()
    const options = { apiKey: SECRET_KEY, model: 'm', logger, retries: 0 }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })))
    await expect(chatCompletion(MESSAGES, options)).rejects.toMatchObject({ statusCode: 429 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await expect(chatCompletion(MESSAGES, options)).rejects.toMatchObject({ statusCode: 502 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(chatCompletion(MESSAGES, options)).rejects.toMatchObject({ statusCode: 502 })

    expect(calls.map((call) => call.data?.reason)).toEqual([
      'http_status',
      'invalid_response',
      'network',
    ])
    expect(calls.every((call) => call.level === 'error')).toBe(true)
  })

  it('records a caller abort as a warning and still throws the abort reason', async () => {
    const controller = new AbortController()
    controller.abort(new Error('caller gave up'))
    vi.stubGlobal('fetch', vi.fn())
    const { calls, logger } = recordingLogger()

    await expect(
      chatCompletion(MESSAGES, { apiKey: 'k', model: 'm', logger, signal: controller.signal }),
    ).rejects.toThrow('caller gave up')
    expect(calls).toEqual([
      expect.objectContaining({ level: 'warn', message: 'AI provider call aborted' }),
    ])
  })

  it('writes nothing without a logger', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion('x')))
    await chatCompletion(MESSAGES, { apiKey: 'k', model: 'm' })
    expect(sink.records).toEqual([])
  })

  it('never puts the key, the messages, the output or the provider error text in a record', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(completion(`echo: ${PROMPT}`))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: `Bad prompt: ${PROMPT}` } }), {
            status: 400,
          }),
        ),
    )
    const logger = requestLogger()

    await chatCompletion(MESSAGES, { apiKey: SECRET_KEY, model: MODEL, logger })
    await expect(
      chatCompletion(MESSAGES, { apiKey: SECRET_KEY, model: MODEL, logger }),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(sink.records.map((record) => [record.level, record.message])).toEqual([
      ['info', '[AI] AI provider call completed'],
      ['error', '[AI] AI provider call failed'],
    ])
    expect(sink.records[0]).toMatchObject({
      scope: 'AI',
      requestId: expect.any(String),
      data: { provider: 'api.x.ai', model: MODEL, promptTokens: null },
    })
    const serialized = JSON.stringify(sink.records)
    expect(serialized).not.toContain(SECRET_KEY)
    expect(serialized).not.toContain('synthetic private prompt')
    expect(serialized).not.toContain('jane@example.com')
  })
})

describe('xAI helper records', () => {
  it('records grokChat success and a rejected request without the error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(completion('hello'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: `Invalid key ${SECRET_KEY}` }), { status: 401 }),
        ),
    )
    const logger = requestLogger()

    await expect(grokChat(SECRET_KEY, MESSAGES, MODEL, { logger })).resolves.toBe('hello')
    await expect(grokChat(SECRET_KEY, MESSAGES, MODEL, { logger })).rejects.toMatchObject({
      statusCode: 401,
    })

    expect(sink.records).toEqual([
      expect.objectContaining({
        level: 'info',
        data: expect.objectContaining({ operation: 'chat.completions', statusCode: 200 }),
      }),
      expect.objectContaining({
        level: 'error',
        data: expect.objectContaining({ reason: 'http_status', statusCode: 401 }),
      }),
    ])
    expect(JSON.stringify(sink.records)).not.toContain(SECRET_KEY)
  })

  it('records time-to-headers for a stream and a timeout for model listing', async () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('data: [DONE]\n', { status: 200 }))
        .mockRejectedValueOnce(timeout),
    )
    const { calls, logger } = recordingLogger()

    await grokChatStream('k', MESSAGES, 'grok-3', { logger })
    await expect(grokListModels('k', { logger })).rejects.toBe(timeout)

    expect(calls).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'AI provider stream opened',
        data: expect.objectContaining({ operation: 'chat.completions.stream', model: 'grok-3' }),
      }),
      expect.objectContaining({
        level: 'error',
        message: 'AI provider call failed',
        data: expect.objectContaining({ operation: 'models.list', reason: 'timeout' }),
      }),
    ])
    expect(calls[1]?.data).not.toHaveProperty('model')
  })
})
