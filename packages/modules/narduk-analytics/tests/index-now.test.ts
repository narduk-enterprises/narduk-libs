import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

const noopLogger = {
  child: () => noopLogger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}

vi.mock('@narduk-enterprises/narduk-core/server/utils/logger', () => ({
  useLogger: () => noopLogger,
}))

const {
  assertIndexNowUrlsBelongToHost,
  indexNowUrlBelongsToHost,
  notifyIndexNow,
  resolveIndexNowKeyFromRuntimeConfig,
} = await import('../server/utils/indexNow')

const SITE_HOST = 'example.com'

function makeEvent(bindings: Record<string, unknown> = {}): H3Event {
  return {
    context: { cloudflare: { env: bindings } },
    method: 'POST',
    path: '/api/indexnow/submit',
  } as unknown as H3Event
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    indexNowKey: '',
    public: { appUrl: 'https://example.com', indexNowKey: '' },
    ...overrides,
  } as unknown as ReturnType<typeof useRuntimeConfig>
}

describe('resolveIndexNowKeyFromRuntimeConfig', () => {
  it('returns an empty string when nothing is configured', () => {
    expect(resolveIndexNowKeyFromRuntimeConfig(makeConfig(), makeEvent())).toBe('')
  })

  it('falls back to the private runtimeConfig key when no event is given', () => {
    expect(resolveIndexNowKeyFromRuntimeConfig(makeConfig({ indexNowKey: 'private-key' }))).toBe(
      'private-key',
    )
  })

  it('falls back to the public runtimeConfig key when the private one is blank', () => {
    const config = makeConfig({ public: { appUrl: '', indexNowKey: 'public-key' } })

    expect(resolveIndexNowKeyFromRuntimeConfig(config)).toBe('public-key')
  })

  it('prefers a live Worker binding over runtimeConfig fallbacks', () => {
    const config = makeConfig({ indexNowKey: 'fallback-key' })
    const event = makeEvent({ INDEXNOW_KEY: 'binding-key' })

    expect(resolveIndexNowKeyFromRuntimeConfig(config, event)).toBe('binding-key')
  })

  it('accepts the NUXT_PUBLIC_INDEXNOW_KEY binding alias', () => {
    const config = makeConfig()
    const event = makeEvent({ NUXT_PUBLIC_INDEXNOW_KEY: 'alias-key' })

    expect(resolveIndexNowKeyFromRuntimeConfig(config, event)).toBe('alias-key')
  })
})

describe('indexNowUrlBelongsToHost', () => {
  it('accepts only URLs on the site host', () => {
    expect(indexNowUrlBelongsToHost('https://example.com/about', SITE_HOST)).toBe(true)
    expect(indexNowUrlBelongsToHost('https://example.com:443/about', SITE_HOST)).toBe(true)
    expect(indexNowUrlBelongsToHost('https://evil.example/about', SITE_HOST)).toBe(false)
    expect(indexNowUrlBelongsToHost('https://example.com.evil/about', SITE_HOST)).toBe(false)
    expect(indexNowUrlBelongsToHost('not-a-url', SITE_HOST)).toBe(false)
  })
})

describe('assertIndexNowUrlsBelongToHost', () => {
  it('rejects a list that contains an off-host URL', () => {
    try {
      assertIndexNowUrlsBelongToHost(
        ['https://example.com/ok', 'https://other.example/leak'],
        SITE_HOST,
      )
      throw new Error('expected host_mismatch')
    } catch (error: unknown) {
      expect(error).toMatchObject({
        statusCode: 400,
        data: {
          state: 'host_mismatch',
          host: SITE_HOST,
          rejected: ['https://other.example/leak'],
        },
      })
    }
  })

  it('accepts an on-host list', () => {
    expect(() =>
      assertIndexNowUrlsBelongToHost(
        ['https://example.com/', 'https://example.com/about'],
        SITE_HOST,
      ),
    ).not.toThrow()
  })
})

describe('indexnow submit route', () => {
  it('keeps caller URLs on SITE_URL host', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'server/api/indexnow/submit.post.ts'),
      'utf8',
    )
    expect(source).toContain('assertIndexNowUrlsBelongToHost')
  })
})

describe('notifyIndexNow', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => makeConfig({ indexNowKey: 'test-key' }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns success with 0 submitted when the URL list is empty', async () => {
    const result = await notifyIndexNow(makeEvent(), [])

    expect(result).toEqual({ success: true, submitted: 0 })
  })

  it('reports failure when no IndexNow key is configured', async () => {
    vi.stubGlobal('useRuntimeConfig', () => makeConfig())

    const result = await notifyIndexNow(makeEvent(), ['https://example.com/page'])

    expect(result).toEqual({
      success: false,
      submitted: 0,
      error: 'INDEXNOW_KEY not configured',
    })
  })

  it('submits the batch to the IndexNow endpoint and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)

    const result = await notifyIndexNow(makeEvent(), [
      'https://example.com/a',
      'https://example.com/b',
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.indexnow.org/indexnow',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          host: 'example.com',
          key: 'test-key',
          keyLocation: 'https://example.com/test-key.txt',
          urlList: ['https://example.com/a', 'https://example.com/b'],
        }),
      }),
    )
    expect(result).toEqual({ success: true, submitted: 2 })
  })

  it('reports failure with the error message when the submission fails', async () => {
    vi.stubGlobal(
      '$fetch',
      vi.fn().mockRejectedValue({ message: 'IndexNow rate limited', status: 429 }),
    )

    const result = await notifyIndexNow(makeEvent(), ['https://example.com/a'])

    expect(result).toEqual({
      success: false,
      submitted: 0,
      error: 'IndexNow rate limited',
    })
  })

  it('reports a host-resolution failure when the site URL cannot be parsed', async () => {
    vi.stubGlobal('useRuntimeConfig', () =>
      makeConfig({ indexNowKey: 'test-key', public: { appUrl: '', indexNowKey: '' } }),
    )

    const result = await notifyIndexNow(makeEvent(), ['https://example.com/a'])

    expect(result).toEqual({
      success: false,
      submitted: 0,
      error: 'Could not determine site host',
    })
  })
})
