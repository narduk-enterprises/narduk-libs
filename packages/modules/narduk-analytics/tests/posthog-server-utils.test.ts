import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  buildPosthogCurrentUrlClause,
  buildPosthogCurrentUrlHostMatch,
  buildPosthogRecordingsCacheKey,
  buildPosthogRecordingsListParams,
  posthogQueryFetch,
  resolvePosthogPeriod,
  resolvePosthogProjectConfig,
  selectRecordingsForDomain,
} from '../server/utils/posthog'

const recordingsRouteSource = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'server/admin/api/admin/posthog/recordings.get.ts',
  ),
  'utf8',
)

const OUR_DOMAIN = 'farm.example'
const OTHER_DOMAIN = 'buoys.example'
const OUR_START_URL = 'https://farm.example/dash'

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

  it('answers 503 not_configured when the personal API key is missing', () => {
    const config = {
      posthogApiKey: '',
      posthogProjectId: '123',
      posthogApiHost: '',
      posthogDomain: '',
      public: {},
    } as unknown as Parameters<typeof resolvePosthogProjectConfig>[0]

    try {
      resolvePosthogProjectConfig(config)
      throw new Error('expected not_configured')
    } catch (error: unknown) {
      expect(error).toMatchObject({
        statusCode: 503,
        data: { state: 'not_configured', missing: ['POSTHOG_PERSONAL_API_KEY'] },
      })
    }
  })

  it('answers 503 not_configured when the project id is missing', () => {
    const config = {
      posthogApiKey: 'phc_key',
      posthogProjectId: '',
      posthogApiHost: '',
      posthogDomain: '',
      public: {},
    } as unknown as Parameters<typeof resolvePosthogProjectConfig>[0]

    try {
      resolvePosthogProjectConfig(config)
      throw new Error('expected not_configured')
    } catch (error: unknown) {
      expect(error).toMatchObject({
        statusCode: 503,
        data: { state: 'not_configured', missing: ['POSTHOG_PROJECT_ID'] },
      })
    }
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
  it('matches the event host exactly or as a subdomain, never as a substring (#924)', () => {
    const host = 'lower(domain(properties.$current_url))'
    expect(buildPosthogCurrentUrlClause('p.nard.uk')).toBe(
      `AND (${host} = 'p.nard.uk' OR endsWith(${host}, '.p.nard.uk'))`,
    )
    expect(buildPosthogCurrentUrlClause('https://Farm.Example/app')).toBe(
      `AND (${host} = 'farm.example' OR endsWith(${host}, '.farm.example'))`,
    )
    expect(buildPosthogCurrentUrlClause("o'reilly.com")).toBe(
      `AND (${host} = 'o''reilly.com' OR endsWith(${host}, '.o''reilly.com'))`,
    )
  })

  it('keeps a backslash in the configured domain inside the string literal', () => {
    const host = 'lower(domain(properties.$current_url))'
    expect(buildPosthogCurrentUrlHostMatch("x\\' or 1=1 --")).toBe(
      `(${host} = 'x\\\\'' or 1=1 --' OR endsWith(${host}, '.x\\\\'' or 1=1 --'))`,
    )
  })

  it('fails closed for a blank domain rather than returning every app (#924)', () => {
    expect(buildPosthogCurrentUrlClause('  ')).toBe('AND false')
    expect(buildPosthogCurrentUrlHostMatch('')).toBe('false')
  })
})

describe('selectRecordingsForDomain', () => {
  it('does not return a recording whose host is a different app', () => {
    const recordings = [
      { id: 'ours', start_url: OUR_START_URL },
      { id: 'theirs', start_url: 'https://buoys.example/status' },
    ]

    expect(selectRecordingsForDomain(recordings, OUR_DOMAIN).map((row) => row.id)).toEqual(['ours'])
  })

  it('rejects a substring lookalike host and a blank start_url', () => {
    const recordings = [
      { id: 'lookalike', start_url: 'https://evil-farm.example/dash' },
      { id: 'blank', start_url: '' },
      { id: 'sub', start_url: 'https://www.farm.example/dash' },
    ]

    expect(selectRecordingsForDomain(recordings, OUR_DOMAIN).map((row) => row.id)).toEqual(['sub'])
  })

  it('returns nothing when POSTHOG_DOMAIN is blank (fail closed)', () => {
    expect(selectRecordingsForDomain([{ id: 'ours', start_url: OUR_START_URL }], '  ')).toEqual([])
  })
})

describe('buildPosthogRecordingsCacheKey', () => {
  it('includes the domain so two apps on one isolate cannot share a listing', () => {
    expect(buildPosthogRecordingsCacheKey('325202', OUR_DOMAIN, 15)).toBe(
      `posthog:recordings:325202:${OUR_DOMAIN}:15`,
    )
    expect(buildPosthogRecordingsCacheKey('325202', OUR_DOMAIN, 15)).not.toBe(
      buildPosthogRecordingsCacheKey('325202', OTHER_DOMAIN, 15),
    )
  })
})

describe('buildPosthogRecordingsListParams', () => {
  it('asks PostHog for $current_url on this domain', () => {
    const params = buildPosthogRecordingsListParams(OUR_DOMAIN, 50)
    expect(params).toMatchObject({ limit: '50', order: '-start_time' })
    expect(JSON.parse(params.events ?? '[]')).toEqual([
      {
        id: '$pageview',
        type: 'events',
        order: 0,
        name: '$pageview',
        properties: [
          {
            key: '$current_url',
            value: OUR_DOMAIN,
            operator: 'icontains',
            type: 'event',
          },
        ],
      },
    ])
  })
})

const scopedRouteSources = ['pages', 'devices', 'entry-exit', 'referrers', 'insights'].map(
  (name) =>
    [
      name,
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          `server/admin/api/admin/posthog/${name}.get.ts`,
        ),
        'utf8',
      ),
    ] as const,
)

describe('HogQL and insights admin routes (#924)', () => {
  it.each(scopedRouteSources)('%s scopes by host and never by substring', (_name, source) => {
    expect(source).toMatch(/buildPosthogCurrentUrl(Clause|HostMatch)\(project\.domain\)/u)
    expect(source).not.toContain('icontains')
    expect(source).not.toMatch(/project\.domain\s*\?/u)
  })
})

describe('recordings admin route', () => {
  it('scopes the handler through the domain helpers', () => {
    expect(recordingsRouteSource).toContain('selectRecordingsForDomain')
    expect(recordingsRouteSource).toContain('buildPosthogRecordingsCacheKey')
    expect(recordingsRouteSource).toContain('buildPosthogRecordingsListParams')
    expect(recordingsRouteSource).not.toMatch(
      /posthog:recordings:\$\{project\.projectId\}:\$\{query\.limit\}/u,
    )
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
