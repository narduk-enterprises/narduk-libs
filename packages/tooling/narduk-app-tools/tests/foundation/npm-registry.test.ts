import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FilesystemRegistryReality,
  SCOPE_PROBE_PACKAGE,
} from '../../src/foundation/npm-registry.js'

const TARGET = '@narduk-enterprises/narduk-shell'

type Reply = { status: number; body?: unknown }

/** Serve one canned reply per package name and record the request order plus
 * the `Accept` header sent on each request. */
function stubRegistry(replies: Record<string, Reply>): {
  requested: string[]
  acceptHeaders: string[]
} {
  const requested: string[] = []
  const acceptHeaders: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: { headers?: Record<string, string> }) => {
    const name = decodeURIComponent(String(url).replace('https://npm.pkg.github.com/', ''))
    requested.push(name)
    acceptHeaders.push(init?.headers?.Accept ?? '')
    const reply = replies[name] ?? { status: 404 }
    return Promise.resolve({
      status: reply.status,
      ok: reply.status >= 200 && reply.status < 300,
      json: () => Promise.resolve(reply.body ?? {}),
    })
  })
  return { requested, acceptHeaders }
}

function reader(
  options?: ConstructorParameters<typeof FilesystemRegistryReality>[1],
): FilesystemRegistryReality {
  return new FilesystemRegistryReality('/nonexistent-repo-root', options)
}

beforeEach(() => {
  vi.stubEnv('NODE_AUTH_TOKEN', 'a-token')
  vi.stubEnv('GH_TOKEN', '')
  vi.stubEnv('GITHUB_TOKEN', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('FilesystemRegistryReality.publicationOf', () => {
  it('is unreadable with no credential, and makes no request', async () => {
    vi.stubEnv('NODE_AUTH_TOKEN', '')
    const { requested } = stubRegistry({})
    expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unreadable' })
    expect(requested).toEqual([])
  })

  it('reads dist-tags.latest as published', async () => {
    stubRegistry({ [TARGET]: { status: 200, body: { 'dist-tags': { latest: '1.4.2' } } } })
    expect(await reader().publicationOf(TARGET)).toEqual({
      status: 'published',
      latest: '1.4.2',
      major: 1,
    })
  })

  it('falls back to the highest version when there is no dist-tag', async () => {
    stubRegistry({
      [TARGET]: { status: 200, body: { versions: { '1.0.0': {}, '3.2.1': {}, '2.0.0': {} } } },
    })
    expect(await reader().publicationOf(TARGET)).toEqual({
      status: 'published',
      latest: '3.2.1',
      major: 3,
    })
  })

  it('treats a readable but empty packument as unpublished', async () => {
    stubRegistry({ [TARGET]: { status: 200, body: { versions: {} } } })
    expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unpublished' })
  })

  it.each([401, 403, 500, 502])('is unreadable on HTTP %i', async (status) => {
    stubRegistry({ [TARGET]: { status } })
    expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unreadable' })
  })

  // narduk-libs#282 review, task 3. GitHub Packages answers "no such package"
  // and "your token cannot see this package" with the same 404. Only the first
  // is a decided fact.
  describe('the ambiguous 404', () => {
    it('is unpublished when the scope probe proves the token can read the scope', async () => {
      const { requested } = stubRegistry({
        [TARGET]: { status: 404 },
        [SCOPE_PROBE_PACKAGE]: { status: 200, body: { 'dist-tags': { latest: '1.23.2' } } },
      })
      expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unpublished' })
      expect(requested).toEqual([TARGET, SCOPE_PROBE_PACKAGE])
    })

    // The mis-scoped-token shape: a token without `read:packages` (or without
    // access to this org's packages) 404s on everything. The old code called
    // that `unpublished`, which item 8 turned into `not-applicable` -- a
    // silent green produced by a broken credential.
    it('is UNREADABLE, not unpublished, when the probe also 404s (mis-scoped token)', async () => {
      stubRegistry({ [TARGET]: { status: 404 }, [SCOPE_PROBE_PACKAGE]: { status: 404 } })
      expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unreadable' })
    })

    it('is unreadable when the probe is itself unreadable (401/timeout)', async () => {
      stubRegistry({ [TARGET]: { status: 404 }, [SCOPE_PROBE_PACKAGE]: { status: 401 } })
      expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unreadable' })
    })

    it('cannot corroborate the probe package itself, so its own 404 is unreadable', async () => {
      const { requested } = stubRegistry({ [SCOPE_PROBE_PACKAGE]: { status: 404 } })
      expect(await reader().publicationOf(SCOPE_PROBE_PACKAGE)).toEqual({ status: 'unreadable' })
      expect(requested).toEqual([SCOPE_PROBE_PACKAGE])
    })

    it('probes at most once per reader however many packages 404', async () => {
      const { requested } = stubRegistry({
        [SCOPE_PROBE_PACKAGE]: { status: 200, body: { 'dist-tags': { latest: '1.23.2' } } },
      })
      const shared = reader()
      expect(await shared.publicationOf(TARGET)).toEqual({ status: 'unpublished' })
      expect(await shared.publicationOf('@narduk-enterprises/narduk-ui')).toEqual({
        status: 'unpublished',
      })
      expect(requested.filter((name) => name === SCOPE_PROBE_PACKAGE)).toHaveLength(1)
    })

    it('never reports a mis-scoped 404 as a readable major to latestPublishedMajor', async () => {
      stubRegistry({ [TARGET]: { status: 404 }, [SCOPE_PROBE_PACKAGE]: { status: 404 } })
      expect(await reader().latestPublishedMajor(TARGET)).toBeNull()
    })
  })
})

// narduk-libs#341: the registry read was a hard 4000 ms abort with no retry,
// which collapsed to `unknown` on the on-prem runner's slow path and blocked
// unrelated PRs. These tests exercise the fetcher's resilience layer:
// abbreviated-Accept header, raised/overridable timeout, and bounded retries
// that never fire on a decided (401/403/404) answer.
describe('FilesystemRegistryReality registry-read resilience (narduk-libs#341)', () => {
  it('sends the abbreviated packument Accept header, with the full shape as fallback', async () => {
    const { acceptHeaders } = stubRegistry({
      [TARGET]: { status: 200, body: { 'dist-tags': { latest: '1.0.0' } } },
    })
    await reader().publicationOf(TARGET)
    expect(acceptHeaders).toEqual(['application/vnd.npm.install-v1+json, application/json'])
  })

  it('parses the version list from an abbreviated-shaped packument body', async () => {
    // GitHub Packages does not honour the abbreviated media type (verified
    // live, see npm-registry.ts), but registries that do answer with a
    // reduced per-version shape -- no `readme`, no `_npmUser`, etc. The
    // parser only reads `dist-tags.latest` / `versions` keys, so it must
    // work unchanged against that shape too.
    stubRegistry({
      [TARGET]: {
        status: 200,
        body: {
          name: TARGET,
          'dist-tags': { latest: '3.2.1' },
          versions: {
            '3.2.1': { name: TARGET, version: '3.2.1', dist: { tarball: 'https://example/x.tgz' } },
            '3.1.0': { name: TARGET, version: '3.1.0', dist: { tarball: 'https://example/y.tgz' } },
          },
        },
      },
    })
    expect(await reader().publicationOf(TARGET)).toEqual({
      status: 'published',
      latest: '3.2.1',
      major: 3,
    })
  })

  it('retries a timeout once and succeeds on the second attempt', async () => {
    let attempts = 0
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
      attempts += 1
      if (attempts === 1) {
        // Simulate a hung request: only settle when the caller's own
        // timeout aborts it, the same as a real fetch() would.
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted.', 'AbortError')
            reject(err)
          })
        })
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ 'dist-tags': { latest: '5.0.0' } }),
      })
    })
    const result = await reader({ fetchTimeoutMs: 20, maxRetries: 2 }).publicationOf(TARGET)
    expect(result).toEqual({ status: 'published', latest: '5.0.0', major: 5 })
    expect(attempts).toBe(2)
  })

  it('retries a 502 up to maxRetries times, then reports unreadable (fail-closed)', async () => {
    const { requested } = stubRegistry({ [TARGET]: { status: 502 } })
    const result = await reader({ fetchTimeoutMs: 20, maxRetries: 2 }).publicationOf(TARGET)
    expect(result).toEqual({ status: 'unreadable' })
    // 1 initial attempt + 2 retries = 3 total.
    expect(requested.filter((name) => name === TARGET)).toHaveLength(3)
  })

  it('never retries a 403 -- exactly one request, reported unreadable', async () => {
    const { requested } = stubRegistry({ [TARGET]: { status: 403 } })
    const result = await reader({ fetchTimeoutMs: 20, maxRetries: 2 }).publicationOf(TARGET)
    expect(result).toEqual({ status: 'unreadable' })
    expect(requested.filter((name) => name === TARGET)).toHaveLength(1)
  })

  it('never retries a 404 -- exactly one request against the target package', async () => {
    const { requested } = stubRegistry({
      [SCOPE_PROBE_PACKAGE]: { status: 200, body: { 'dist-tags': { latest: '1.0.0' } } },
    })
    const result = await reader({ fetchTimeoutMs: 20, maxRetries: 2 }).publicationOf(TARGET)
    expect(result).toEqual({ status: 'unpublished' })
    expect(requested.filter((name) => name === TARGET)).toHaveLength(1)
  })

  it('defaults fetchTimeoutMs to 20000ms', () => {
    // Constructing with no options must not throw and must not pick up a
    // stray env override left by another test.
    vi.stubEnv('NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS', '')
    const instance = reader() as unknown as { fetchTimeoutMs: number }
    expect(instance.fetchTimeoutMs).toBe(20_000)
  })

  it('honours NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS when no explicit option is passed', () => {
    vi.stubEnv('NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS', '9000')
    const instance = reader() as unknown as { fetchTimeoutMs: number }
    expect(instance.fetchTimeoutMs).toBe(9000)
  })

  it('an explicit fetchTimeoutMs option always wins over the env override', () => {
    vi.stubEnv('NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS', '9000')
    const instance = reader({ fetchTimeoutMs: 1234 }) as unknown as { fetchTimeoutMs: number }
    expect(instance.fetchTimeoutMs).toBe(1234)
  })

  it('ignores a non-numeric env override and falls back to the default', () => {
    vi.stubEnv('NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS', 'not-a-number')
    const instance = reader() as unknown as { fetchTimeoutMs: number }
    expect(instance.fetchTimeoutMs).toBe(20_000)
  })
})
