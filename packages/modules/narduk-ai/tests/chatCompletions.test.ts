import { afterEach, describe, expect, it, vi } from 'vitest'

import { chatCompletion, chatCompletionJson, parseChatJson } from '../server/utils/chatCompletions'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const MESSAGES = [{ role: 'user' as const, content: 'hi' }]

function completion(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], ...extra }), {
    status: 200,
  })
}

describe('chatCompletion', () => {
  it('sends the OpenAI-compatible request with only the options given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      completion(' answer ', {
        model: 'gpt-4o-mini-2024',
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(MESSAGES, {
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1/',
      model: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 50,
      json: true,
    })

    expect(result).toEqual({
      content: 'answer',
      model: 'gpt-4o-mini-2024',
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-4o-mini',
      messages: MESSAGES,
      temperature: 0.2,
      max_tokens: 50,
      response_format: { type: 'json_object' },
    })
  })

  it('defaults to xAI, omits unset options and reports null usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion('x'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(MESSAGES, { apiKey: 'k', model: 'grok-3-mini' })
    expect(result).toEqual({ content: 'x', model: 'grok-3-mini', usage: null })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.x.ai/v1/chat/completions')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'grok-3-mini', messages: MESSAGES })
  })

  it('retries one 5xx by default, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream down', { status: 503 }))
      .mockResolvedValueOnce(completion('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(chatCompletion(MESSAGES, { apiKey: 'k', model: 'm' })).resolves.toMatchObject({
      content: 'ok',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx, and never puts the raw provider body in the message', async () => {
    const leaky = 'prompt was: my secret prompt; account acct_123'
    const fetchMock = vi.fn().mockResolvedValue(new Response(leaky, { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    const error = await chatCompletion(MESSAGES, { apiKey: 'k', model: 'm' }).catch((e) => e)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(error).toMatchObject({
      statusCode: 400,
      message: 'Failed to reach the chat completion provider.',
    })
    expect(String(error.message)).not.toContain('secret prompt')
  })

  it('keeps a structured provider message, like grokChat', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
        ),
    )
    await expect(chatCompletion(MESSAGES, { apiKey: 'k', model: 'm' })).rejects.toMatchObject({
      statusCode: 429,
      message: 'rate limited',
    })
  })

  it('gives up after the retries on repeated 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      chatCompletion(MESSAGES, { apiKey: 'k', model: 'm', retries: 2 }),
    ).rejects.toMatchObject({ statusCode: 502 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('times out a hung request as a 504 and retries it', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      chatCompletion(MESSAGES, { apiKey: 'k', model: 'm', timeoutMs: 10 }),
    ).rejects.toMatchObject({ statusCode: 504, message: expect.stringContaining('10 ms') })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the caller aborts', async () => {
    const caller = new AbortController()
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('caller aborted')))
          caller.abort()
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      chatCompletion(MESSAGES, { apiKey: 'k', model: 'm', signal: caller.signal }),
    ).rejects.toThrow('caller aborted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails a response with no message content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await expect(chatCompletion(MESSAGES, { apiKey: 'k', model: 'm' })).rejects.toMatchObject({
      statusCode: 502,
    })
  })
})

describe('chatCompletionJson', () => {
  it('forces JSON mode, strips a fence and validates with the parser', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion('```json\n{"n": 2}\n```'))
    vi.stubGlobal('fetch', fetchMock)
    const parse = (value: unknown) => {
      const n = (value as { n?: unknown }).n
      if (typeof n !== 'number') throw new Error('bad shape')
      return { n }
    }

    const result = await chatCompletionJson(MESSAGES, parse, { apiKey: 'k', model: 'm' })
    expect(result.data).toEqual({ n: 2 })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' })
  })

  it('propagates the validator error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion('{"n":"x"}')))
    await expect(
      chatCompletionJson(
        MESSAGES,
        () => {
          throw new Error('bad shape')
        },
        { apiKey: 'k', model: 'm' },
      ),
    ).rejects.toThrow('bad shape')
  })
})

describe('parseChatJson', () => {
  it('reads bare and fenced JSON and rejects prose', () => {
    expect(parseChatJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseChatJson('```\n[1,2]\n```')).toEqual([1, 2])
    expect(parseChatJson('  ```JSON {"a":true}```  ')).toEqual({ a: true })
    expect(() => parseChatJson('Sure! Here is JSON')).toThrow(/invalid JSON/)
  })
})
