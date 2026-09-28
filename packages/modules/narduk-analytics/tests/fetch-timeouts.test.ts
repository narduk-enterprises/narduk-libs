import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every outbound call in this package's server code carries a timeout
 * (narduk/require-fetch-timeout), and a timeout reaches the caller through the
 * same error handling a network failure already takes. These tests stub the
 * upstream to hang until its abort signal fires, fire it, and assert the
 * caller's existing failure shape — no real waiting.
 */

const logger = vi.hoisted(() => {
  const log = {
    child: () => log,
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
  return log
})

vi.mock('@narduk-enterprises/narduk-core/server/utils/logger', () => ({
  useLogger: () => logger,
}))

vi.mock('jose', () => ({
  importPKCS8: vi.fn().mockResolvedValue('mock-private-key'),
  SignJWT: vi.fn().mockImplementation(function SignJWTMock() {
    return {
      setProtectedHeader: vi.fn().mockReturnThis(),
      sign: vi.fn().mockResolvedValue('mock.jwt.token'),
    }
  }),
}))

// The route files import from the consuming app's layer; run their handler
// bodies directly.
vi.mock('#layer/server/utils/mutation', () => {
  const wrap =
    (_options: unknown, handler: (context: { body: unknown; event: unknown }) => unknown) =>
    (event: { body?: unknown }) =>
      handler({ event, body: event.body })
  return {
    defineAdminMutation: wrap,
    definePublicMutation: wrap,
    requireMutationBody: (body: unknown) => body,
    withOptionalValidatedBody: () => () => {},
    withValidatedBody: () => () => {},
  }
})

vi.mock('#layer/server/utils/rateLimit', () => ({
  RATE_LIMIT_POLICIES: { googleIndexingBatch: {}, indexNowSubmit: {} },
}))

const serviceAccount = JSON.stringify({
  client_email: 'svc@example.iam.gserviceaccount.com',
  private_key: 'fake-private-key',
})

const TIMEOUT_REASON = () =>
  new DOMException('The operation was aborted due to timeout', 'TimeoutError')

/**
 * Replace `AbortSignal.timeout` with a signal the test fires by hand, and a
 * `fetch` that never settles until its signal aborts — the way a stalled
 * upstream behaves once the timeout elapses.
 */
function stallUpstreamFetch() {
  const controllers: AbortController[] = []
  const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const controller = new AbortController()
    controllers.push(controller)
    return controller.signal
  })
  const fetchMock = vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return // no signal: hangs forever, and the test times out
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    timeoutSpy,
    fireTimeouts() {
      for (const controller of controllers) controller.abort(TIMEOUT_REASON())
    },
  }
}

/** Let pending promise continuations (token exchange, then the call) run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('createError', createError)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Google token exchange (server/utils/google.ts getAccessToken)', () => {
  it('bounds the exchange and rejects with the TimeoutError when it stalls', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ googleServiceAccountKey: serviceAccount }))
    const upstream = stallUpstreamFetch()
    const { getAccessToken, GA_SCOPES } = await import('../server/utils/google')

    const pending = getAccessToken(GA_SCOPES)
    await flush()

    expect(upstream.timeoutSpy).toHaveBeenCalledWith(10_000)
    expect(upstream.fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    upstream.fireTimeouts()
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

describe('googleApiFetch default timeout', () => {
  it('adds a 15s signal when the caller passes none', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ googleServiceAccountKey: serviceAccount }))
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { googleApiFetch, GSC_SCOPES } = await import('../server/utils/google')

    await expect(googleApiFetch('https://api.example/x', GSC_SCOPES)).resolves.toEqual({
      rows: [],
    })

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) })
  })

  it("keeps the caller's own signal", async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ googleServiceAccountKey: serviceAccount }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const { googleApiFetch, GSC_SCOPES } = await import('../server/utils/google')
    const own = new AbortController().signal

    await googleApiFetch('https://api.example/x', GSC_SCOPES, { signal: own })

    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(own)
  })
})

describe('POST /api/admin/indexing/batch', () => {
  it('answers the existing 500 batch error when the Indexing API stalls', async () => {
    const upstream = stallUpstreamFetch()
    vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
    vi.stubGlobal('INDEXING_SCOPES', ['scope'])
    vi.stubGlobal('getAccessToken', vi.fn().mockResolvedValue('token'))
    vi.stubGlobal('buildBatchBody', vi.fn().mockReturnValue('batch-body'))
    vi.stubGlobal('parseBatchResponse', vi.fn())
    const handler = (await import('../server/admin/api/admin/indexing/batch.post')).default as (
      event: unknown,
    ) => Promise<unknown>

    const pending = handler({
      body: { urls: ['https://example.com/a'], type: 'URL_UPDATED' },
      context: {},
    })
    await flush()

    expect(upstream.timeoutSpy).toHaveBeenCalledWith(30_000)
    expect(upstream.fetchMock).toHaveBeenCalledWith(
      'https://indexing.googleapis.com/batch',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    upstream.fireTimeouts()
    await expect(pending).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: expect.stringContaining('Google Indexing API batch error'),
    })
    expect(logger.error).toHaveBeenCalledWith(
      'Batch indexing failed',
      expect.objectContaining({ error: expect.stringContaining('timeout') }),
    )
  })
})

describe('POST /api/indexnow/submit', () => {
  it('reports a stalled engine as a failed ping, like any other network failure', async () => {
    const upstream = stallUpstreamFetch()
    vi.stubGlobal('useRuntimeConfig', () => ({
      indexNowKey: 'test-key',
      public: { appUrl: 'https://example.com' },
    }))
    const handler = (await import('../server/api/indexnow/submit.post')).default as (
      event: unknown,
    ) => Promise<{ results: unknown[] }>

    const pending = handler({ body: { urls: ['https://example.com/a'] }, context: {} })
    await flush()

    expect(upstream.timeoutSpy).toHaveBeenCalledWith(10_000)
    upstream.fireTimeouts()
    await expect(pending).resolves.toMatchObject({
      results: [{ engine: 'https://api.indexnow.org/indexnow', ok: false, status: 0 }],
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to ping https://api.indexnow.org/indexnow',
      expect.objectContaining({ error: expect.stringContaining('timeout') }),
    )
  })
})

/** The rejection ofetch produces when its `timeout` elapses. */
function ofetchTimeoutError(method: string, url: string) {
  return Object.assign(
    new Error(`[${method}] "${url}": <no response> The operation was aborted due to timeout`),
    { name: 'FetchError', status: undefined as number | undefined },
  )
}

describe('notifyIndexNow ($fetch)', () => {
  it('passes a 10s timeout and reports a timeout as a failed submission', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      indexNowKey: 'test-key',
      public: { appUrl: 'https://example.com' },
    }))
    const fetchMock = vi
      .fn()
      .mockRejectedValue(ofetchTimeoutError('POST', 'https://api.indexnow.org/indexnow'))
    vi.stubGlobal('$fetch', fetchMock)
    const { notifyIndexNow } = await import('../server/utils/indexNow')

    const result = await notifyIndexNow({ context: {} } as never, ['https://example.com/a'])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.indexnow.org/indexnow',
      expect.objectContaining({ timeout: 10_000 }),
    )
    expect(result).toMatchObject({ success: false, submitted: 0 })
    expect(result.error).toContain('timeout')
  })
})

describe('PostHog fetches ($fetch)', () => {
  const project = {
    apiHost: 'https://p.example.com',
    apiKey: 'phc_key',
    domain: 'example.com',
    projectId: '123',
  }

  it('bounds the HogQL query and rejects with the FetchError the routes turn into a 500', async () => {
    const timeoutError = ofetchTimeoutError('POST', 'https://p.example.com/api/projects/123/query/')
    const fetchMock = vi.fn().mockRejectedValue(timeoutError)
    vi.stubGlobal('$fetch', fetchMock)
    const { posthogQueryFetch } = await import('../server/utils/posthog')

    await expect(posthogQueryFetch(project, { kind: 'HogQLQuery' })).rejects.toBe(timeoutError)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://p.example.com/api/projects/123/query/',
      expect.objectContaining({ timeout: 20_000 }),
    )
  })

  it('bounds the recordings list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ results: [] })
    vi.stubGlobal('$fetch', fetchMock)
    const { posthogRecordingsFetch } = await import('../server/utils/posthog')

    await posthogRecordingsFetch(project, { limit: '5' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://p.example.com/api/projects/123/session_recordings/',
      expect.objectContaining({ timeout: 20_000, method: 'GET' }),
    )
  })

  it('the admin route answers a PostHog timeout as the existing 500 "PostHog Error"', async () => {
    vi.doMock('@narduk-enterprises/narduk-core/server/utils/auth', () => ({
      requireAdmin: vi.fn().mockResolvedValue(undefined),
    }))
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getValidatedQuery', async () => ({ period: '30d', noCache: true }))
    vi.stubGlobal('useRuntimeConfig', () => ({
      posthogApiKey: 'phc_key',
      posthogProjectId: '123',
      posthogApiHost: 'https://p.example.com',
      posthogDomain: 'example.com',
      public: {},
    }))
    vi.stubGlobal('cachedAnalyticsFetch', async (_key: string, load: () => Promise<unknown>) => ({
      data: await load(),
      cached: false,
      fetchedAt: 'now',
    }))
    const timeoutError = ofetchTimeoutError('POST', 'https://p.example.com/api/projects/123/query/')
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(timeoutError))
    const handler = (await import('../server/admin/api/admin/posthog/pages.get')).default as (
      event: unknown,
    ) => Promise<unknown>

    await expect(handler({ context: {} })).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: expect.stringContaining('PostHog Error'),
    })
  })
})
