import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ponytail-5 s8 repro for #2003 analytics-seo-devices #12: the submit route
 * put the site path into `keyLocation`, accepted more URLs than IndexNow takes,
 * and reported a rejected batch as submitted.
 */
vi.mock('@narduk-enterprises/narduk-core/server/utils/logger', () => {
  const log = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  return { useLogger: () => log }
})
vi.mock('#layer/server/utils/mutation', () => ({
  definePublicMutation:
    (
      options: { parseBody: (body: unknown) => unknown },
      handler: (context: { body: unknown; event: unknown }) => unknown,
    ) =>
    async (event: { body?: unknown }) =>
      handler({ event, body: await options.parseBody(event.body) }),
  requireMutationBody: (body: unknown) => body,
  withOptionalValidatedBody: (parse: (body: unknown) => unknown) => parse,
}))
vi.mock('#layer/server/utils/rateLimit', () => ({ RATE_LIMIT_POLICIES: { indexNowSubmit: {} } }))

type Handler = (event: unknown) => Promise<{ submitted: number }>

let sent: { keyLocation: string } | undefined

beforeEach(() => {
  vi.resetModules()
  sent = undefined
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('useRuntimeConfig', () => ({
    indexNowKey: 'test-key',
    public: { appUrl: 'https://example.com/docs' },
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as { keyLocation: string }
      return new Response(null, { status: 400 })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const submit = async (urls: string[]) =>
  ((await import('../server/api/indexnow/submit.post')).default as Handler)({
    body: { urls },
    context: {},
  })

describe('POST /api/indexnow/submit', () => {
  it('points keyLocation at the key file this package serves, and counts a rejection as 0', async () => {
    const result = await submit(['https://example.com/docs/a'])
    expect(sent?.keyLocation).toBe('https://example.com/test-key.txt')
    expect(result.submitted).toBe(0)
  })

  it('refuses more URLs than one IndexNow batch takes', async () => {
    const urls = Array.from({ length: 10_001 }, (_, i) => `https://example.com/${i}`)
    await expect(submit(urls)).rejects.toThrow()
    expect(sent).toBeUndefined()
  })
})
