import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FilesystemRegistryReality,
  SCOPE_PROBE_PACKAGE,
  encodePackumentName,
  parseScopeRoute,
  readScopeRoute,
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
  // Pinned for the same reason as the three above, and the reason is sharper
  // now that the reader consults a fourth name: every "no credential" case
  // below asserts on the absence of an Authorization header, and an
  // unstubbed name is one the developer's own shell can fill in. A suite that
  // reads the machine it runs on is green on a bare CI runner and red on a
  // workstation, which is a test reporting on the environment rather than on
  // the code (agent-infrastructure#1644).
  vi.stubEnv('GH_PACKAGES_READ', '')
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

// narduk-libs#498: the packument base follows the project's own
// `@narduk-enterprises` route -- the last `@narduk-enterprises:registry=` line
// in `.npmrc`, the same rule as narduk-enterprises/workflows#108.
describe('parseScopeRoute (narduk-libs#498)', () => {
  const mirror = { kind: 'anonymous', base: 'https://npm.nard.uk' }
  const github = { kind: 'github-packages' }

  it.each([
    ['no file', undefined, github],
    ['empty file', '', github],
    ['no route line', 'auto-install-peers=false\n', github],
    ['GitHub Packages', '@narduk-enterprises:registry=https://npm.pkg.github.com\n', github],
    [
      'GitHub Packages, trailing slash',
      '@narduk-enterprises:registry=https://npm.pkg.github.com/\n',
      github,
    ],
    ['the mirror', '@narduk-enterprises:registry=https://npm.nard.uk/\n', mirror],
    ['the mirror, no slash', '@narduk-enterprises:registry=https://npm.nard.uk\n', mirror],
    ['quoted, spaced', '  @narduk-enterprises:registry = "https://npm.nard.uk"  \n', mirror],
    ['CRLF line ending', '@narduk-enterprises:registry=https://npm.nard.uk/\r\n', mirror],
    ['commented out (#)', '# @narduk-enterprises:registry=https://npm.nard.uk/\n', github],
    ['commented out (;)', '; @narduk-enterprises:registry=https://npm.nard.uk/\n', github],
    ['another scope only', '@narduk-geo:registry=https://npm.nard.uk/\n', github],
    ['empty value', '@narduk-enterprises:registry=\n', github],
    ['not a URL', '@narduk-enterprises:registry=npm.nard.uk\n', github],
    ['non-http scheme', '@narduk-enterprises:registry=file:///tmp/registry\n', github],
  ])('%s', (_case, npmrc, expected) => {
    expect(parseScopeRoute(npmrc)).toEqual(expected)
  })

  it('the last route line wins: mirror then GitHub Packages is GitHub Packages (break-glass)', () => {
    expect(
      parseScopeRoute(
        '@narduk-enterprises:registry=https://npm.nard.uk/\n' +
          '@narduk-enterprises:registry=https://npm.pkg.github.com\n',
      ),
    ).toEqual(github)
  })

  it('the last route line wins: GitHub Packages then mirror is the mirror', () => {
    expect(
      parseScopeRoute(
        '@narduk-enterprises:registry=https://npm.pkg.github.com\n' +
          'auto-install-peers=false\n' +
          '@narduk-enterprises:registry=https://npm.nard.uk/\n',
      ),
    ).toEqual(mirror)
  })

  it('a commented-out later line does not override an earlier live one', () => {
    expect(
      parseScopeRoute(
        '@narduk-enterprises:registry=https://npm.nard.uk/\n' +
          '# @narduk-enterprises:registry=https://npm.pkg.github.com\n',
      ),
    ).toEqual(mirror)
  })

  it('treats a lookalike host generically (anonymous), never as GitHub Packages', () => {
    expect(
      parseScopeRoute('@narduk-enterprises:registry=https://npm.nard.uk.example.com/\n'),
    ).toEqual({ kind: 'anonymous', base: 'https://npm.nard.uk.example.com' })
  })

  describe('readScopeRoute', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'scope-route-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('defaults to GitHub Packages when the project has no .npmrc', () => {
      expect(readScopeRoute(dir)).toEqual(github)
    })

    it('reads the project .npmrc', () => {
      writeFileSync(join(dir, '.npmrc'), '@narduk-enterprises:registry=https://npm.nard.uk/\n')
      expect(readScopeRoute(dir)).toEqual(mirror)
    })
  })
})

describe('FilesystemRegistryReality on the project route (narduk-libs#498)', () => {
  type Seen = { url: string; headers: Record<string, string> }

  function stubAny(status: number, body: unknown = {}): Seen[] {
    const seen: Seen[] = []
    vi.stubGlobal('fetch', (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url: String(url), headers: { ...(init?.headers ?? {}) } })
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(body),
      })
    })
    return seen
  }

  function repoWithNpmrc(npmrc: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'route-repo-'))
    writeFileSync(join(dir, '.npmrc'), npmrc)
    return dir
  }

  it('encodes a scoped name the way the mirror expects', () => {
    expect(encodePackumentName('@narduk-enterprises/narduk-core')).toBe(
      '@narduk-enterprises%2fnarduk-core',
    )
  })

  it('reads the mirror from the project .npmrc with no Authorization header, even with a token set', async () => {
    const dir = repoWithNpmrc('@narduk-enterprises:registry=https://npm.nard.uk/\n')
    try {
      const seen = stubAny(200, { 'dist-tags': { latest: '1.23.2' } })
      const result = await new FilesystemRegistryReality(dir).publicationOf(SCOPE_PROBE_PACKAGE)
      expect(result).toEqual({ status: 'published', latest: '1.23.2', major: 1 })
      expect(seen.map((entry) => entry.url)).toEqual([
        'https://npm.nard.uk/@narduk-enterprises%2fnarduk-core',
      ])
      expect(seen[0]?.headers).not.toHaveProperty('Authorization')
      expect(seen[0]?.headers.Accept).toBe('application/vnd.npm.install-v1+json, application/json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads the mirror with no credential at all (the #498 done-when shape)', async () => {
    vi.stubEnv('NODE_AUTH_TOKEN', '')
    const seen = stubAny(200, { 'dist-tags': { latest: '2.0.0' } })
    const result = await reader({
      scopeRoute: { kind: 'anonymous', base: 'https://npm.nard.uk' },
    }).latestPublishedMajor(TARGET)
    expect(result).toBe(2)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.headers).not.toHaveProperty('Authorization')
  })

  it('never sends the token to a lookalike route', async () => {
    const seen = stubAny(200, { 'dist-tags': { latest: '1.0.0' } })
    await reader({
      scopeRoute: parseScopeRoute('@narduk-enterprises:registry=https://npm.nard.uk.example.com/'),
    }).publicationOf(TARGET)
    expect(seen[0]?.url).toBe('https://npm.nard.uk.example.com/@narduk-enterprises%2fnarduk-shell')
    expect(seen[0]?.headers).not.toHaveProperty('Authorization')
  })

  it('does not scope-probe on the mirror: a 404 is a decided unpublished, one request', async () => {
    const seen = stubAny(404)
    const result = await reader({
      scopeRoute: { kind: 'anonymous', base: 'https://npm.nard.uk' },
    }).publicationOf(TARGET)
    expect(result).toEqual({ status: 'unpublished' })
    expect(seen.map((entry) => entry.url)).toEqual([
      'https://npm.nard.uk/@narduk-enterprises%2fnarduk-shell',
    ])
  })

  it.each([401, 403])('is unreadable on a mirror HTTP %i', async (status) => {
    stubAny(status)
    const result = await reader({
      scopeRoute: { kind: 'anonymous', base: 'https://npm.nard.uk' },
    }).publicationOf(TARGET)
    expect(result).toEqual({ status: 'unreadable' })
  })

  it('keeps the GitHub Packages route unchanged: fixed base, Bearer token, unencoded name', async () => {
    const seen = stubAny(200, { 'dist-tags': { latest: '1.0.0' } })
    await reader({ scopeRoute: { kind: 'github-packages' } }).publicationOf(TARGET)
    expect(seen[0]?.url).toBe('https://npm.pkg.github.com/@narduk-enterprises/narduk-shell')
    expect(seen[0]?.headers.Authorization).toBe('Bearer a-token')
  })

  it('keeps other scopes on GitHub Packages even when @narduk-enterprises is mirrored', async () => {
    const seen = stubAny(200, { 'dist-tags': { latest: '1.0.0' } })
    await reader({
      scopeRoute: { kind: 'anonymous', base: 'https://npm.nard.uk' },
    }).publicationOf('@narduk-geo/grid')
    expect(seen[0]?.url).toBe('https://npm.pkg.github.com/@narduk-geo/grid')
    expect(seen[0]?.headers.Authorization).toBe('Bearer a-token')
  })
})

describe('credential name resolution (narduk-farm#148)', () => {
  /** Local to this block: the `stubAny` above is scoped to the route describe.
   * Records the headers actually sent, which is the only place the resolved
   * credential is observable from outside. */
  function stubRequests(status: number, body: unknown = {}): { headers: Record<string, string> }[] {
    const seen: { headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', (_url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ headers: { ...(init?.headers ?? {}) } })
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(body),
      })
    })
    return seen
  }

  /** Absent, not empty. `??` treats an exported-but-empty variable as a
   * value and stops there, so a test that "clears" a name with '' is
   * asserting something different from a name the shell never set. The
   * sanctioned local route leaves these three unset, which is the case
   * these tests are about. */
  const clearPrecedingNames = () => {
    vi.stubEnv('NODE_AUTH_TOKEN', undefined)
    vi.stubEnv('GH_TOKEN', undefined)
    vi.stubEnv('GITHUB_TOKEN', undefined)
  }

  it('authenticates from GH_PACKAGES_READ when no other name is set', async () => {
    clearPrecedingNames()
    vi.stubEnv('GH_PACKAGES_READ', 'packages-read-token')
    const seen = stubRequests(200, { 'dist-tags': { latest: '2.7.0' } })
    expect(await reader().latestPublishedMajor(TARGET)).toBe(2)
    expect(seen[0]?.headers.Authorization).toBe('Bearer packages-read-token')
  })

  it('is unreadable when GH_PACKAGES_READ is the only name and it is empty', async () => {
    clearPrecedingNames()
    const { requested } = stubRegistry({})
    expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unreadable' })
    expect(requested).toEqual([])
  })

  it('prefers NODE_AUTH_TOKEN over GH_PACKAGES_READ when both are set', async () => {
    vi.stubEnv('GH_PACKAGES_READ', 'packages-read-token')
    const seen = stubRequests(200, { 'dist-tags': { latest: '2.7.0' } })
    await reader().publicationOf(TARGET)
    // `a-token` is the suite-wide NODE_AUTH_TOKEN. In CI both names carry the
    // same value (workflows#85 aliases one to the other), so this ordering is
    // what makes the new name purely additive rather than a change to a
    // working path.
    expect(seen[0]?.headers.Authorization).toBe('Bearer a-token')
  })

  it('sends no credential to a mirrored scope route, GH_PACKAGES_READ included', async () => {
    clearPrecedingNames()
    vi.stubEnv('GH_PACKAGES_READ', 'packages-read-token')
    const seen = stubRequests(200, { 'dist-tags': { latest: '2.7.0' } })
    await reader({
      scopeRoute: { kind: 'anonymous', base: 'https://npm.nard.uk' },
    }).publicationOf(TARGET)
    expect(seen[0]?.headers).not.toHaveProperty('Authorization')
  })

  it('documents that an exported-but-empty earlier name shadows the fallback', async () => {
    // Not the behaviour anyone wants, but it is what `??` means and it is
    // better pinned than rediscovered. No caller produces this today: the
    // shared workflow exports NODE_AUTH_TOKEN only after resolving a
    // non-empty credential, and `gh-packages-run` sets neither. Collapsing
    // empty to absent would be a real improvement and a behaviour change for
    // every consumer, so it belongs in its own change, not this one.
    vi.stubEnv('NODE_AUTH_TOKEN', '')
    vi.stubEnv('GH_PACKAGES_READ', 'packages-read-token')
    const { requested } = stubRegistry({})
    expect(await reader().publicationOf(TARGET)).toEqual({ status: 'unreadable' })
    expect(requested).toEqual([])
  })
})

// Live, opt-in: NARDUK_LIVE_REGISTRY_TEST=1. Proves the mirror answers the
// encoded packument path anonymously; skipped by default so unit runs never
// touch the network.
describe.skipIf(process.env.NARDUK_LIVE_REGISTRY_TEST !== '1')(
  'live npm.nard.uk anonymous read (opt-in)',
  () => {
    it('reads narduk-core from the mirror with no credential', async () => {
      vi.stubEnv('NODE_AUTH_TOKEN', '')
      const result = await reader({
        scopeRoute: { kind: 'anonymous', base: 'https://npm.nard.uk' },
      }).publicationOf(SCOPE_PROBE_PACKAGE)
      expect(result.status).toBe('published')
    }, 60_000)
  },
)
