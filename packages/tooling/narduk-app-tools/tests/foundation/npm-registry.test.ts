import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FilesystemRegistryReality,
  SCOPE_PROBE_PACKAGE,
} from '../../src/foundation/npm-registry.js'

const TARGET = '@narduk-enterprises/narduk-shell'

type Reply = { status: number; body?: unknown }

/** Serve one canned reply per package name and record the request order. */
function stubRegistry(replies: Record<string, Reply>): { requested: string[] } {
  const requested: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    const name = decodeURIComponent(String(url).replace('https://npm.pkg.github.com/', ''))
    requested.push(name)
    const reply = replies[name] ?? { status: 404 }
    return Promise.resolve({
      status: reply.status,
      ok: reply.status >= 200 && reply.status < 300,
      json: () => Promise.resolve(reply.body ?? {}),
    })
  })
  return { requested }
}

function reader(): FilesystemRegistryReality {
  return new FilesystemRegistryReality('/nonexistent-repo-root')
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
