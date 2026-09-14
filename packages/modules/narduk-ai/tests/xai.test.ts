import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createXaiSseStreamParser,
  grokChat,
  grokChatStream,
  grokListModels,
} from '../server/utils/xai'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('xAI helpers', () => {
  it('sends non-stored chat requests and trims the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: ' answer ' } }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(grokChat('secret', [{ role: 'user', content: 'hello' }], 'grok-4')).resolves.toBe(
      'answer',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.x.ai/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: expect.stringContaining('"store":false'),
      }),
    )
  })

  it('converts structured xAI errors without exposing the API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'model unavailable' } }), {
          status: 429,
        }),
      ),
    )

    await expect(grokChat('secret-key', [], 'missing')).rejects.toMatchObject({
      statusCode: 429,
      message: 'model unavailable',
    })
    await expect(grokChat('secret-key', [], 'missing')).rejects.not.toMatchObject({
      message: expect.stringContaining('secret-key'),
    })
  })

  it('extracts content from split SSE records and ignores malformed/done records', async () => {
    const first = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hel')
    const second = new TextEncoder().encode('lo"}}]}\n\ndata: malformed\n\ndata: [DONE]\n')
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first)
        controller.enqueue(second)
        controller.close()
      },
    })

    await expect(new Response(source.pipeThrough(createXaiSseStreamParser())).text()).resolves.toBe(
      'hello',
    )
  })

  it('passes through xAI model listing and reports list failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ id: 'grok-4', object: 'model' }] })),
        ),
    )
    await expect(grokListModels('secret')).resolves.toEqual([{ id: 'grok-4', object: 'model' }])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(grokListModels('secret')).rejects.toMatchObject({
      statusCode: 500,
      message: 'Failed to list xAI models.',
    })
  })

  it('fails closed when a successful stream has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))

    await expect(grokChatStream('secret', [], 'grok-4')).rejects.toMatchObject({
      statusCode: 502,
      message: 'xAI returned an empty stream.',
    })
  })
})
