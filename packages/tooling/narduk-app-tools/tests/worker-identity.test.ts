import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { fetchWorkerPlainTextVars, readDeploymentList } from '../src/cloudflare.js'
import {
  DEFAULT_ALIAS_CONSECUTIVE,
  convergeFixedAliasIdentity,
  evaluatePreviewDiagnostics,
  provePreviewIdentity,
  readRobotsMeta,
} from '../src/preview-proof.js'
import { VERSION_TAG_ANNOTATION, type WorkerVersion } from '../src/promote.js'
import { resolveActiveWorkerVersion } from '../src/worker-deployment.js'
import { bindWorkerIdentity, readRuntimeIdentity } from '../src/worker-identity.js'

import type { LiveResponse } from '../src/live-probe.js'

const OLD_VERSION = '11111111-1111-4111-8111-111111111111'
const NEW_VERSION = '22222222-2222-4222-8222-222222222222'
const OLD_SHA = '21f1d78f'
const NEW_SHA = 'b8cc59e1'

function cfOk(result: unknown): Response {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function deployment(
  id: string,
  versionId: string,
  createdOn: string,
  percentage = 100,
  extraVersions: Array<{ version_id: string; percentage: number }> = [],
) {
  return {
    id,
    created_on: createdOn,
    versions: [{ version_id: versionId, percentage }, ...extraVersions],
  }
}

function bindingsFor(versionId: string, siteUrl: string) {
  return {
    id: versionId,
    resources: {
      bindings: [{ type: 'plain_text', name: 'SITE_URL', text: siteUrl }],
    },
  }
}

function version(id: string, tag?: string): WorkerVersion {
  return {
    id,
    ...(tag === undefined ? {} : { annotations: { [VERSION_TAG_ANNOTATION]: tag } }),
  }
}

/**
 * Provider fixture whose versions inventory lists the stale upload first and
 * whose deployment allocation has already moved to a newer UUID. Position-based
 * selection reads the stale vars; allocation-based selection reads the live
 * ones.
 */
function providerFetch(options: { versions: Array<{ id: string }>; deployments: unknown }): {
  fetchImpl: typeof fetch
  requested: string[]
} {
  const requested: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    requested.push(url)
    if (url.includes('/deployments')) return cfOk(options.deployments)
    if (/\/versions\/[^/?#]+/u.test(url)) {
      const versionId = url.split('/versions/')[1]?.split(/[?#]/u)[0] ?? ''
      const siteUrl = versionId === NEW_VERSION ? 'https://new.example' : 'https://old.example'
      return cfOk(bindingsFor(decodeURIComponent(versionId), siteUrl))
    }
    if (url.includes('/versions')) return cfOk({ items: options.versions })
    return cfOk({})
  }
  return { fetchImpl, requested }
}

const inventoryOldestFirst = [{ id: OLD_VERSION }, { id: NEW_VERSION }]
const liveNew = [
  deployment('d-old', OLD_VERSION, '2026-07-30T00:00:00Z'),
  deployment('d-new', NEW_VERSION, '2026-07-30T01:00:00Z'),
]

function live(partial: Partial<LiveResponse> & { url?: string }): LiveResponse {
  return { url: partial.url ?? 'https://preview.example/api/health', ...partial }
}

function clock() {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
    },
  }
}

describe('fetchWorkerPlainTextVars provider identity (#47)', () => {
  it('does not treat versions.items[0] as the live Worker (#47)', async () => {
    const { fetchImpl, requested } = providerFetch({
      versions: inventoryOldestFirst,
      deployments: { deployments: liveNew },
    })
    const vars = await fetchWorkerPlainTextVars({
      accountId: 'acc',
      apiToken: 'token',
      scriptName: 'fixture',
      fetchImpl,
    })
    expect(vars.SITE_URL).toBe('https://new.example')
    expect(requested.some((url) => url.includes(`/versions/${NEW_VERSION}`))).toBe(true)
    expect(requested.some((url) => url.includes(`/versions/${OLD_VERSION}`))).toBe(false)
    expect(requested.some((url) => /\/versions\?per_page=/u.test(url))).toBe(false)
  })

  it.each([
    { order: 'oldest-first', rows: liveNew },
    { order: 'newest-first', rows: [...liveNew].reverse() },
  ])('resolves the same 100% version from a $order deployments list', async ({ rows }) => {
    const { fetchImpl } = providerFetch({
      versions: inventoryOldestFirst,
      deployments: { deployments: [...rows] },
    })
    await expect(
      fetchWorkerPlainTextVars({
        accountId: 'acc',
        apiToken: 'token',
        scriptName: 'fixture',
        fetchImpl,
      }),
    ).resolves.toEqual({ SITE_URL: 'https://new.example' })
  })

  it('accepts a raw deployments array and an items-shaped deployments envelope', async () => {
    for (const envelope of [liveNew, { items: liveNew }] as const) {
      const { fetchImpl } = providerFetch({
        versions: inventoryOldestFirst,
        deployments: envelope,
      })
      await expect(
        fetchWorkerPlainTextVars({
          accountId: 'acc',
          apiToken: 'token',
          scriptName: 'fixture',
          fetchImpl,
        }),
      ).resolves.toEqual({ SITE_URL: 'https://new.example' })
    }
  })

  it('refuses an empty deployments list instead of reading inventory[0]', async () => {
    const { fetchImpl, requested } = providerFetch({
      versions: inventoryOldestFirst,
      deployments: { deployments: [] },
    })
    await expect(
      fetchWorkerPlainTextVars({
        accountId: 'acc',
        apiToken: 'token',
        scriptName: 'fixture',
        fetchImpl,
      }),
    ).rejects.toThrow(/no active Worker deployment/iu)
    expect(requested.some((url) => url.includes('/versions/'))).toBe(false)
  })

  it('refuses a split allocation instead of reading inventory[0]', async () => {
    const { fetchImpl, requested } = providerFetch({
      versions: inventoryOldestFirst,
      deployments: {
        deployments: [
          deployment('d-split', OLD_VERSION, '2026-07-30T02:00:00Z', 50, [
            { version_id: NEW_VERSION, percentage: 50 },
          ]),
        ],
      },
    })
    await expect(
      fetchWorkerPlainTextVars({
        accountId: 'acc',
        apiToken: 'token',
        scriptName: 'fixture',
        fetchImpl,
      }),
    ).rejects.toThrow(/split/iu)
    expect(requested.some((url) => /\/versions\/[^/?#]+/u.test(url))).toBe(false)
  })

  it('does not let a duplicated inventory row override allocation', async () => {
    const { fetchImpl } = providerFetch({
      versions: [{ id: OLD_VERSION }, { id: OLD_VERSION }, { id: NEW_VERSION }],
      deployments: { deployments: liveNew },
    })
    await expect(
      fetchWorkerPlainTextVars({
        accountId: 'acc',
        apiToken: 'token',
        scriptName: 'fixture',
        fetchImpl,
      }),
    ).resolves.toEqual({ SITE_URL: 'https://new.example' })
  })
})

describe('resolveActiveWorkerVersion (#47)', () => {
  it('refuses undated deployments rather than using list position', () => {
    expect(
      resolveActiveWorkerVersion([
        { id: 'd1', versions: [{ version_id: OLD_VERSION, percentage: 100 }] },
        { id: 'd2', versions: [{ version_id: NEW_VERSION, percentage: 100 }] },
      ]),
    ).toEqual({ kind: 'undated' })
  })

  it('treats a shared newest timestamp with disagreeing versions as ambiguous', () => {
    const stamp = '2026-07-30T03:00:00Z'
    expect(
      resolveActiveWorkerVersion([
        deployment('d-a', OLD_VERSION, stamp),
        deployment('d-b', NEW_VERSION, stamp),
      ]).kind,
    ).toBe('ambiguous')
  })

  it('reads both envelope shapes as the same allocation list', () => {
    expect(readDeploymentList({ deployments: liveNew }).map((row) => row.id)).toEqual([
      'd-old',
      'd-new',
    ])
    expect(readDeploymentList({ items: liveNew }).map((row) => row.id)).toEqual(['d-old', 'd-new'])
    expect(readDeploymentList(liveNew).map((row) => row.id)).toEqual(['d-old', 'd-new'])
  })
})

describe('bindWorkerIdentity (#47)', () => {
  const inventory = [version(OLD_VERSION, OLD_SHA), version(NEW_VERSION, NEW_SHA)]

  it('never treats inventory[0] as the expected version', () => {
    expect(
      bindWorkerIdentity({
        expected: { sha: NEW_SHA },
        runtime: { sha: NEW_SHA },
        inventory,
      }),
    ).toMatchObject({ kind: 'bound', versionId: NEW_VERSION, sha: NEW_SHA })
  })

  it('accepts a missing runtime tag only with exact provider UUID/SHA binding', () => {
    expect(
      bindWorkerIdentity({
        expected: { versionId: NEW_VERSION, sha: NEW_SHA },
        runtime: { sha: null, versionId: null },
        inventory,
      }),
    ).toMatchObject({ kind: 'missing-runtime-tag-accepted', versionId: NEW_VERSION, sha: NEW_SHA })
  })

  it('rejects a contradictory non-null runtime tag', () => {
    expect(
      bindWorkerIdentity({
        expected: { versionId: NEW_VERSION, sha: NEW_SHA },
        runtime: { sha: OLD_SHA },
        inventory,
      }).kind,
    ).toBe('contradictory-runtime-tag')
  })

  it('rejects a wrong UUID even when the SHA tag exists on another row', () => {
    expect(
      bindWorkerIdentity({
        expected: { versionId: '33333333-3333-4333-8333-333333333333', sha: NEW_SHA },
        runtime: { sha: NEW_SHA },
        inventory,
      }).kind,
    ).toBe('wrong-uuid')
  })

  it('rejects a SHA that the expected UUID does not carry', () => {
    expect(
      bindWorkerIdentity({
        expected: { versionId: NEW_VERSION, sha: OLD_SHA },
        runtime: { sha: OLD_SHA },
        inventory,
      }).kind,
    ).toBe('wrong-sha')
  })

  it('rejects an ambiguous SHA tag', () => {
    expect(
      bindWorkerIdentity({
        expected: { sha: NEW_SHA },
        runtime: { sha: NEW_SHA },
        inventory: [version(OLD_VERSION, NEW_SHA), version(NEW_VERSION, NEW_SHA)],
      }).kind,
    ).toBe('ambiguous')
  })

  it('does not accept a missing runtime tag without an inventory SHA binding', () => {
    expect(
      bindWorkerIdentity({
        expected: { versionId: NEW_VERSION, sha: NEW_SHA },
        runtime: { sha: null },
        inventory: [version(NEW_VERSION)],
      }).kind,
    ).toBe('wrong-sha')
  })
})

describe('readRuntimeIdentity', () => {
  it('prefers x-build-version and only accepts a UUID worker version', () => {
    expect(
      readRuntimeIdentity(
        live({
          headers: { 'x-build-version': NEW_SHA, 'x-worker-version': NEW_VERSION },
          body: JSON.stringify({ data: { status: 'ok', version: OLD_SHA, id: 'not-a-uuid' } }),
        }),
      ),
    ).toEqual({ sha: NEW_SHA, versionId: NEW_VERSION })
  })
})

describe('fixed-alias convergence (#47)', () => {
  it('refuses a one-shot match as the default threshold', () => {
    expect(DEFAULT_ALIAS_CONSECUTIVE).toBeGreaterThan(1)
  })

  it('cannot pass an oscillating alias until consecutive exact identity is met', async () => {
    const sequence = [OLD_SHA, NEW_SHA, OLD_SHA, NEW_SHA, OLD_SHA, NEW_SHA]
    let index = 0
    const time = clock()
    const result = await convergeFixedAliasIdentity({
      url: 'https://preview.example/api/health',
      expected: { sha: NEW_SHA, versionId: NEW_VERSION },
      inventory: [version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 1_000,
      intervalMs: 100,
      ...time,
      probe: async () =>
        live({
          status: 200,
          headers: { 'x-build-version': sequence[index++ % sequence.length] },
        }),
    })
    expect(result.converged).toBe(false)
    expect(result.consecutiveMatched).toBeLessThan(3)
    expect(result.observations.length).toBeGreaterThan(1)
    expect(result.observations.every((row) => !('authorization' in row))).toBe(true)
    expect(JSON.stringify(result.observations)).not.toMatch(/bearer /iu)
  })

  it('passes only after the configured consecutive exact-identity threshold', async () => {
    const sequence = [OLD_SHA, NEW_SHA, NEW_SHA, NEW_SHA]
    let index = 0
    const time = clock()
    const result = await convergeFixedAliasIdentity({
      url: 'https://preview.example/api/health',
      expected: { sha: NEW_SHA },
      inventory: [version(OLD_VERSION, OLD_SHA), version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 1_000,
      intervalMs: 50,
      ...time,
      probe: async () =>
        live({
          status: 200,
          headers: { 'x-build-version': sequence[Math.min(index++, sequence.length - 1)] },
        }),
    })
    expect(result.converged).toBe(true)
    expect(result.consecutiveMatched).toBe(3)
    expect(result.observations.filter((row) => row.matched).length).toBe(3)
  })

  it('does not treat missing runtime tags as alias convergence', async () => {
    const time = clock()
    const result = await convergeFixedAliasIdentity({
      url: 'https://preview.example/api/health',
      expected: { sha: NEW_SHA, versionId: NEW_VERSION },
      inventory: [version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 1_000,
      intervalMs: 10,
      ...time,
      probe: async () =>
        live({
          status: 200,
          headers: {},
          body: JSON.stringify({ success: true, data: { status: 'ok' } }),
        }),
    })
    expect(result.converged).toBe(false)
    expect(result.binding?.kind).toBe('missing-runtime-tag-accepted')
    expect(result.observations.every((row) => row.matched === false)).toBe(true)
  })

  it('does not treat a failed probe as alias convergence', async () => {
    const time = clock()
    const result = await convergeFixedAliasIdentity({
      url: 'https://preview.example/api/health',
      expected: { sha: NEW_SHA, versionId: NEW_VERSION },
      inventory: [version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 400,
      intervalMs: 10,
      ...time,
      probe: async () => live({ error: 'network failed' }),
    })
    expect(result.converged).toBe(false)
    expect(result.observations.every((row) => row.matched === false)).toBe(true)
  })

  it('treats a stale alias that never reaches the expected SHA as a timeout', async () => {
    const time = clock()
    const result = await convergeFixedAliasIdentity({
      url: 'https://preview.example/api/health',
      expected: { sha: NEW_SHA },
      inventory: [version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 400,
      intervalMs: 100,
      ...time,
      probe: async () => live({ status: 200, headers: { 'x-build-version': OLD_SHA } }),
    })
    expect(result.converged).toBe(false)
    expect(result.observations.every((row) => row.sha === OLD_SHA)).toBe(true)
  })
})

describe('post-convergence diagnostics (#47)', () => {
  const origin = 'https://preview.example'

  function page(path: string, response: LiveResponse): [string, LiveResponse] {
    return [
      new URL(path, origin).toString(),
      { ...response, url: new URL(path, origin).toString() },
    ]
  }

  it('does not treat index as a match inside noindex', () => {
    const mismatches = evaluatePreviewDiagnostics(
      origin,
      new Map([
        page('/', {
          url: `${origin}/`,
          status: 200,
          headers: { 'x-robots-tag': 'noindex, follow', 'content-type': 'text/html' },
          body: '<html><head><meta name="robots" content="noindex, follow"></head></html>',
        }),
      ]),
      { robotsHeader: 'index', robotsMeta: 'index' },
    )
    expect(mismatches.map((row) => row.id).sort()).toEqual(['robots-header', 'robots-meta'])
  })

  it('accepts a first-hop 302 when the probe did not follow the redirect', () => {
    const mismatches = evaluatePreviewDiagnostics(
      origin,
      new Map([
        page('/old', {
          url: `${origin}/old`,
          status: 302,
          redirected: true,
          finalUrl: `${origin}/new`,
          headers: { location: '/new' },
        }),
      ]),
      { redirects: [{ path: '/old', to: '/new', status: 302 }] },
    )
    expect(mismatches).toEqual([])
  })

  it('keeps a matching robots header and still reports an indexable robots meta', () => {
    const mismatches = evaluatePreviewDiagnostics(
      origin,
      new Map([
        page('/', {
          url: `${origin}/`,
          status: 200,
          headers: { 'x-robots-tag': 'noindex', 'content-type': 'text/html' },
          body: '<html><head><meta name="robots" content="index, follow"></head></html>',
        }),
      ]),
      { robotsHeader: 'noindex', robotsMeta: 'noindex' },
    )
    expect(mismatches.map((row) => row.id)).toEqual(['robots-meta'])
  })

  it('reports both robots defects when the header and the meta are wrong', () => {
    const mismatches = evaluatePreviewDiagnostics(
      origin,
      new Map([
        page('/', {
          url: `${origin}/`,
          status: 200,
          headers: { 'x-robots-tag': 'index, follow', 'content-type': 'text/html' },
          body: '<html><head><meta name="robots" content="index, follow"></head></html>',
        }),
      ]),
      { robotsHeader: 'noindex', robotsMeta: 'noindex' },
    )
    expect(mismatches.map((row) => row.id).sort()).toEqual(['robots-header', 'robots-meta'])
  })

  it('records redirect, stale-route, and health-field mismatches together', () => {
    const mismatches = evaluatePreviewDiagnostics(
      origin,
      new Map([
        page('/', {
          url: `${origin}/`,
          status: 200,
          redirected: true,
          finalUrl: 'https://other.example/',
          headers: { 'cache-control': 'public, max-age=60' },
          body: '<html></html>',
        }),
        page('/missing', { url: `${origin}/missing`, status: 404 }),
        page('/api/health', {
          url: `${origin}/api/health`,
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ success: true, data: { status: 'error', database: 'ok' } }),
        }),
      ]),
      {
        redirects: [{ path: '/', none: true }],
        routes: [{ path: '/missing', status: 200 }],
        cacheControlIncludes: ['no-store'],
        health: { path: '/api/health', status: 'ok', fields: { database: 'ok' } },
      },
    )
    const ids = mismatches.map((row) => row.id)
    expect(ids).toContain('redirect:/')
    expect(ids).toContain('route:/missing')
    expect(ids).toContain('cache-policy')
    expect(ids).toContain('health-status')
    expect(ids).not.toContain('health-field:database')
  })

  it('reads robots meta regardless of attribute order', () => {
    expect(readRobotsMeta('<meta content="noindex" name="robots">')).toBe('noindex')
  })
})

describe('provePreviewIdentity (#47)', () => {
  it('skips diagnostics until identity converges, then reports every mismatch', async () => {
    let reads = 0
    const time = clock()
    const probe = async (url: string): Promise<LiveResponse> => {
      reads += 1
      if (url.includes('/api/health')) {
        return live({
          url,
          status: 200,
          headers: { 'x-build-version': NEW_SHA },
          body: JSON.stringify({ success: true, data: { status: 'ok' } }),
        })
      }
      return live({
        url,
        status: 200,
        headers: { 'x-robots-tag': 'noindex', 'content-type': 'text/html' },
        body: '<html><head><meta name="robots" content="index, follow"></head></html>',
      })
    }
    const passingIdentity = await provePreviewIdentity({
      origin: 'https://preview.example',
      expected: { sha: NEW_SHA, versionId: NEW_VERSION },
      inventory: [version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 1_000,
      intervalMs: 10,
      ...time,
      probe,
      diagnostics: { robotsHeader: 'noindex', robotsMeta: 'noindex' },
    })
    expect(passingIdentity.converged).toBe(true)
    expect(passingIdentity.result).toBe('FAIL')
    expect(passingIdentity.mismatches.map((row) => row.id)).toEqual(['robots-meta'])
    expect(reads).toBeGreaterThan(3)

    reads = 0
    const stale = await provePreviewIdentity({
      origin: 'https://preview.example',
      expected: { sha: NEW_SHA },
      inventory: [version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 300,
      intervalMs: 100,
      ...clock(),
      probe: async (url) =>
        live({
          url,
          status: 200,
          headers: { 'x-build-version': OLD_SHA },
          body: '<html><head><meta name="robots" content="index, follow"></head></html>',
        }),
      diagnostics: { robotsHeader: 'noindex', robotsMeta: 'noindex' },
    })
    expect(stale.converged).toBe(false)
    expect(stale.result).toBe('FAIL')
    expect(stale.mismatches.map((row) => row.id)).toEqual(['identity-convergence'])
    expect(stale.observations.length).toBeGreaterThan(0)
  })

  it('probes redirect paths without following so a 302 status is meaningful', async () => {
    const seen: Array<{ url: string; redirect?: 'follow' | 'manual' }> = []
    const time = clock()
    const result = await provePreviewIdentity({
      origin: 'https://preview.example',
      expected: { sha: NEW_SHA, versionId: NEW_VERSION },
      inventory: [version(NEW_VERSION, NEW_SHA)],
      consecutive: 3,
      timeoutMs: 1_000,
      intervalMs: 10,
      ...time,
      probe: async (url, options) => {
        seen.push({ url, redirect: options?.redirect })
        if (url.endsWith('/old')) {
          return live({
            url,
            status: 302,
            redirected: true,
            finalUrl: 'https://preview.example/new',
            headers: { location: '/new' },
          })
        }
        return live({
          url,
          status: 200,
          headers: { 'x-build-version': NEW_SHA },
          body: JSON.stringify({ success: true, data: { status: 'ok' } }),
        })
      },
      diagnostics: { redirects: [{ path: '/old', to: '/new', status: 302 }] },
    })
    expect(result.converged).toBe(true)
    expect(result.result).toBe('PASS')
    expect(seen.some((row) => row.url.endsWith('/old') && row.redirect === 'manual')).toBe(true)
  })
})

describe('position-based selection cannot return (#47)', () => {
  it('keeps fetchWorkerPlainTextVars off versions.items[0]', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/cloudflare.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/versions\.items\s*\?\.\s*\[\s*0\s*\]/u)
    expect(source).not.toMatch(/items\s*\?\.\s*\[\s*0\s*\]\s*\?\.\s*id/u)
  })
})
