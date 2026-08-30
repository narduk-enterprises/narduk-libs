import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const importPKCS8 = vi.fn().mockResolvedValue('mock-private-key')
const signJwtSign = vi.fn().mockResolvedValue('mock.jwt.token')

vi.mock('jose', () => ({
  importPKCS8,
  SignJWT: vi.fn().mockImplementation(function SignJWTMock() {
    return {
      setProtectedHeader: vi.fn().mockReturnThis(),
      sign: signJwtSign,
    }
  }),
}))

const serviceAccount = {
  client_email: 'svc@example.iam.gserviceaccount.com',
  private_key: 'fake-private-key',
}

function stubRuntimeConfig(config: Record<string, unknown>): void {
  vi.stubGlobal('useRuntimeConfig', () => config)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  importPKCS8.mockResolvedValue('mock-private-key')
  signJwtSign.mockResolvedValue('mock.jwt.token')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getAccessToken', () => {
  it('mints a JWT via the service account and exchanges it for an access token', async () => {
    stubRuntimeConfig({ googleServiceAccountKey: JSON.stringify(serviceAccount) })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-token-1', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getAccessToken, GA_SCOPES } = await import('../server/utils/google')
    const token = await getAccessToken(GA_SCOPES)

    expect(token).toBe('access-token-1')
    expect(signJwtSign).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('decodes a base64-encoded service account key', async () => {
    stubRuntimeConfig({
      googleServiceAccountKey: Buffer.from(JSON.stringify(serviceAccount)).toString('base64'),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'access-token-b64', expires_in: 3600 }),
      }),
    )

    const { getAccessToken, GA_SCOPES } = await import('../server/utils/google')
    await expect(getAccessToken(GA_SCOPES)).resolves.toBe('access-token-b64')
  })

  it('caches the token for repeated calls with the same scopes', async () => {
    stubRuntimeConfig({ googleServiceAccountKey: JSON.stringify(serviceAccount) })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'cached-token', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getAccessToken, GSC_SCOPES } = await import('../server/utils/google')

    const first = await getAccessToken(GSC_SCOPES)
    const second = await getAccessToken(GSC_SCOPES)

    expect(first).toBe('cached-token')
    expect(second).toBe('cached-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when the service account key is not configured', async () => {
    stubRuntimeConfig({ googleServiceAccountKey: '' })
    const { getAccessToken, INDEXING_SCOPES } = await import('../server/utils/google')

    await expect(getAccessToken(INDEXING_SCOPES)).rejects.toThrow(/not configured/)
  })

  it('throws a descriptive error when the token exchange fails', async () => {
    stubRuntimeConfig({ googleServiceAccountKey: JSON.stringify(serviceAccount) })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid_grant',
      }),
    )

    const { getAccessToken, GA_SCOPES } = await import('../server/utils/google')

    await expect(getAccessToken(GA_SCOPES)).rejects.toThrow(/Google token exchange failed/)
  })
})

describe('buildBatchBody / parseBatchResponse', () => {
  it('builds a multipart/mixed batch body with one part per URL', async () => {
    const { buildBatchBody } = await import('../server/utils/google')
    const body = buildBatchBody(
      ['https://example.com/a', 'https://example.com/b'],
      'URL_UPDATED',
      'batch-boundary',
    )

    expect(body).toContain('--batch-boundary')
    expect(body).toContain('Content-ID: <item1>')
    expect(body).toContain('Content-ID: <item2>')
    expect(body).toContain('"url":"https://example.com/a"')
    expect(body.trim().endsWith('--batch-boundary--')).toBe(true)
  })

  it('parses a multipart/mixed batch response back into status/body pairs', async () => {
    const { parseBatchResponse } = await import('../server/utils/google')
    const boundary = 'resp-boundary'
    const response = [
      `--${boundary}`,
      'Content-Type: application/http',
      '',
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      '{"urlNotificationMetadata":{"url":"https://example.com/a"}}',
      `--${boundary}`,
      'Content-Type: application/http',
      '',
      'HTTP/1.1 404 Not Found',
      '',
      '{"error":{"message":"not found"}}',
      `--${boundary}--`,
    ].join('\r\n')

    const results = parseBatchResponse(response, boundary)

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ index: 0, status: 200 })
    expect(results[1]).toMatchObject({ index: 1, status: 404 })
  })
})

describe('googleApiFetch', () => {
  it('throws GoogleApiError with the response status and body on failure', async () => {
    stubRuntimeConfig({ googleServiceAccountKey: JSON.stringify(serviceAccount) })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'insufficient_scope' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { googleApiFetch, GoogleApiError, GA_SCOPES } = await import('../server/utils/google')

    await expect(googleApiFetch('https://example.com/api', GA_SCOPES, {})).rejects.toThrow(
      GoogleApiError,
    )
  })

  it('returns the parsed JSON response on success', async () => {
    stubRuntimeConfig({ googleServiceAccountKey: JSON.stringify(serviceAccount) })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [1, 2, 3] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { googleApiFetch, GA_SCOPES } = await import('../server/utils/google')

    await expect(googleApiFetch('https://example.com/api', GA_SCOPES, {})).resolves.toEqual({
      rows: [1, 2, 3],
    })
  })
})
