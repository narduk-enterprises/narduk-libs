import { describe, expect, it } from 'vitest'

import {
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
