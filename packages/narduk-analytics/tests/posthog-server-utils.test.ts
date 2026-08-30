import { describe, expect, it, vi } from 'vitest'

import {
  buildPosthogCurrentUrlClause,
  posthogQueryFetch,
  resolvePosthogPeriod,
  resolvePosthogProjectConfig,
} from '../server/utils/posthog'

describe('resolvePosthogProjectConfig', () => {
  it('resolves apiKey/projectId/apiHost/domain from config without an event', () => {
    const config = {
      posthogApiKey: ' phc_key ',
      posthogProjectId: ' 123 ',
      posthogApiHost: 'https://p.example.com/',
      posthogDomain: '',
      public: { appUrl: 'https://myapp.com' },
    } as unknown as Parameters<typeof resolvePosthogProjectConfig>[0]

    const result = resolvePosthogProjectConfig(config)

    expect(result).toEqual({
      apiKey: 'phc_key',
      projectId: '123',
      apiHost: 'https://p.example.com',
      domain: 'myapp.com',
    })
  })

  it('throws when the personal API key is missing', () => {
    const config = {
      posthogApiKey: '',
      posthogProjectId: '123',
      posthogApiHost: '',
      posthogDomain: '',
      public: {},
    } as unknown as Parameters<typeof resolvePosthogProjectConfig>[0]

    expect(() => resolvePosthogProjectConfig(config)).toThrow(/POSTHOG_PERSONAL_API_KEY/)
  })

  it('throws when the project id is missing', () => {
    const config = {
      posthogApiKey: 'phc_key',
      posthogProjectId: '',
      posthogApiHost: '',
      posthogDomain: '',
      public: {},
    } as unknown as Parameters<typeof resolvePosthogProjectConfig>[0]

    expect(() => resolvePosthogProjectConfig(config)).toThrow(/POSTHOG_PROJECT_ID/)
  })
})

describe('resolvePosthogPeriod', () => {
  it('parses day and hour periods', () => {
    expect(resolvePosthogPeriod('7d')).toMatchObject({ value: 7, unit: 'd', dateFrom: '-7d' })
    expect(resolvePosthogPeriod('24h')).toMatchObject({ value: 24, unit: 'h', dateFrom: '-24h' })
  })

  it('defaults to 30d for missing or malformed input', () => {
    expect(resolvePosthogPeriod(undefined)).toMatchObject({ value: 30, unit: 'd' })
    expect(resolvePosthogPeriod('garbage')).toMatchObject({ value: 30, unit: 'd' })
    expect(resolvePosthogPeriod('0d')).toMatchObject({ value: 30, unit: 'd' })
  })
})

describe('buildPosthogCurrentUrlClause', () => {
  it('builds a HogQL LIKE clause and escapes single quotes', () => {
    expect(buildPosthogCurrentUrlClause('example.com')).toBe(
      "AND properties.$current_url LIKE '%example.com%'",
    )
    expect(buildPosthogCurrentUrlClause("o'reilly.com")).toBe(
      "AND properties.$current_url LIKE '%o''reilly.com%'",
    )
  })

  it('returns an empty string for a blank domain', () => {
    expect(buildPosthogCurrentUrlClause('  ')).toBe('')
  })
})

describe('posthogQueryFetch', () => {
  it('posts the HogQL query to the PostHog project query endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ results: [[1, 2]] })
    vi.stubGlobal('$fetch', fetchMock)

    const config = {
      apiHost: 'https://p.example.com',
      apiKey: 'phc_key',
      domain: 'example.com',
      projectId: '123',
    }

    const result = await posthogQueryFetch(config, { kind: 'HogQLQuery', query: 'SELECT 1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://p.example.com/api/projects/123/query/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer phc_key' }),
      }),
    )
    expect(result).toEqual({ results: [[1, 2]] })

    vi.unstubAllGlobals()
  })
})
