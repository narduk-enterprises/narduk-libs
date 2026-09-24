import { describe, expect, it } from 'vitest'

import {
  canonicalRobotsPolicy,
  hostAwareIndexRule,
  hostAwareNoindexRule,
  isNonCanonicalIndexingHost,
  normalizeIndexingHost,
} from '../shared/hostAwareIndexing'

const canonicalHost = 'lakestat.us'
const canonicalSiteUrl = 'https://lakestat.us'
const previewAliasHost = 'bfe918b0-lakestat-us.narduk-enterprises.workers.dev'

describe('normalizeIndexingHost', () => {
  it('normalizes full URLs to lowercase hostnames', () => {
    expect(normalizeIndexingHost(canonicalSiteUrl)).toBe(canonicalHost)
    expect(normalizeIndexingHost('https://LAKESTAT.US/path?q=1')).toBe(canonicalHost)
  })

  it('accepts bare hosts and strips ports', () => {
    expect(normalizeIndexingHost(canonicalHost)).toBe(canonicalHost)
    expect(normalizeIndexingHost('lakestat.us:443')).toBe(canonicalHost)
    expect(normalizeIndexingHost('localhost:3000')).toBe('localhost')
  })

  it('normalizes invalid or empty input to the empty string', () => {
    expect(normalizeIndexingHost('')).toBe('')
    expect(normalizeIndexingHost('   ')).toBe('')
    expect(normalizeIndexingHost()).toBe('')
    expect(normalizeIndexingHost(42)).toBe('')
    expect(normalizeIndexingHost('https://')).toBe('')
  })
})

describe('isNonCanonicalIndexingHost', () => {
  it('flags a workers.dev preview alias of a canonical site', () => {
    expect(isNonCanonicalIndexingHost(previewAliasHost, canonicalSiteUrl)).toBe(true)
  })

  it('does not flag the canonical host, regardless of case or port', () => {
    expect(isNonCanonicalIndexingHost(canonicalHost, canonicalSiteUrl)).toBe(false)
    expect(isNonCanonicalIndexingHost('LAKESTAT.US', canonicalSiteUrl)).toBe(false)
    expect(isNonCanonicalIndexingHost('lakestat.us:443', canonicalSiteUrl)).toBe(false)
  })

  it('fails open when either host is missing or unparseable', () => {
    expect(isNonCanonicalIndexingHost('localhost:3000', '')).toBe(false)
    expect(isNonCanonicalIndexingHost('', canonicalSiteUrl)).toBe(false)
    expect(isNonCanonicalIndexingHost()).toBe(false)
  })
})

describe('hostAwareNoindexRule', () => {
  it('matches the module noindex rule string', () => {
    expect(hostAwareNoindexRule).toBe('noindex, nofollow')
  })
})

describe('canonicalRobotsPolicy (narduk-libs#836)', () => {
  const indexRobots = 'index, follow, max-image-preview:large'
  const noindexRobots = 'noindex, nofollow'

  it('defaults to the directive strings the apps hardcode today', () => {
    expect(hostAwareIndexRule).toBe(indexRobots)
    expect(canonicalRobotsPolicy(canonicalHost, canonicalHost)).toBe(indexRobots)
    expect(canonicalRobotsPolicy(previewAliasHost, canonicalHost)).toBe(noindexRobots)
  })

  it('accepts the canonical host as a hostname or a site URL', () => {
    expect(canonicalRobotsPolicy(canonicalHost, canonicalSiteUrl)).toBe(indexRobots)
    expect(canonicalRobotsPolicy('https://lakestat.us/lakes', canonicalHost)).toBe(indexRobots)
  })

  it('ignores case, port and scheme on the request host', () => {
    expect(canonicalRobotsPolicy('LAKESTAT.US', canonicalHost)).toBe(indexRobots)
    expect(canonicalRobotsPolicy('lakestat.us:443', canonicalHost)).toBe(indexRobots)
    expect(canonicalRobotsPolicy('http://lakestat.us:8080', 'LakeStat.us')).toBe(indexRobots)
  })

  it('does not strip www or a trailing dot', () => {
    expect(canonicalRobotsPolicy('www.lakestat.us', canonicalHost)).toBe(noindexRobots)
    expect(canonicalRobotsPolicy('lakestat.us.', canonicalHost)).toBe(noindexRobots)
    expect(canonicalRobotsPolicy('localhost:3000', canonicalHost)).toBe(noindexRobots)
  })

  it('treats listed additional canonical hostnames as canonical', () => {
    const options = { additionalCanonicalHostnames: ['WWW.lakestat.us', 'https://lakestat.us.'] }

    expect(canonicalRobotsPolicy('www.lakestat.us', canonicalHost, options)).toBe(indexRobots)
    expect(canonicalRobotsPolicy('lakestat.us.', canonicalHost, options)).toBe(indexRobots)
    expect(canonicalRobotsPolicy(canonicalHost, canonicalHost, options)).toBe(indexRobots)
    expect(canonicalRobotsPolicy(previewAliasHost, canonicalHost, options)).toBe(noindexRobots)
  })

  it('ignores additional canonical hostnames that do not normalize', () => {
    const options = { additionalCanonicalHostnames: ['', '   ', 42, null] }

    expect(canonicalRobotsPolicy(previewAliasHost, canonicalHost, options)).toBe(noindexRobots)
    expect(canonicalRobotsPolicy('', canonicalHost, options)).toBe(noindexRobots)
  })

  it('returns noindex on the canonical host when the route is not indexable', () => {
    expect(canonicalRobotsPolicy(canonicalHost, canonicalHost, { indexable: false })).toBe(
      noindexRobots,
    )
    expect(canonicalRobotsPolicy(previewAliasHost, canonicalHost, { indexable: false })).toBe(
      noindexRobots,
    )
    expect(canonicalRobotsPolicy(canonicalHost, canonicalHost, { indexable: true })).toBe(
      indexRobots,
    )
  })

  it('treats a request host that does not normalize as non-canonical', () => {
    expect(canonicalRobotsPolicy('', canonicalHost)).toBe(noindexRobots)
    expect(canonicalRobotsPolicy(undefined, canonicalHost)).toBe(noindexRobots)
    expect(canonicalRobotsPolicy('https://', canonicalHost)).toBe(noindexRobots)
  })

  it('fails open when the canonical hostname does not normalize', () => {
    expect(canonicalRobotsPolicy(previewAliasHost, '')).toBe(indexRobots)
    expect(canonicalRobotsPolicy(previewAliasHost, undefined)).toBe(indexRobots)
    expect(canonicalRobotsPolicy(previewAliasHost, '', { indexable: false })).toBe(noindexRobots)
  })

  it('uses overridden directive strings', () => {
    const options = {
      canonicalRobots: 'index, follow',
      nonCanonicalRobots: 'noindex, nofollow, noarchive',
    }

    expect(canonicalRobotsPolicy(canonicalHost, canonicalHost, options)).toBe('index, follow')
    expect(canonicalRobotsPolicy(previewAliasHost, canonicalHost, options)).toBe(
      'noindex, nofollow, noarchive',
    )
    expect(
      canonicalRobotsPolicy(canonicalHost, canonicalHost, { ...options, indexable: false }),
    ).toBe('noindex, nofollow, noarchive')
  })
})
