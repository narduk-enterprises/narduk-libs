import { describe, expect, it } from 'vitest'

import {
  isInternalAnalyticsTraffic,
  isLocalAnalyticsHost,
  isPreviewAnalyticsHost,
  normalizeAnalyticsLoadStrategy,
  resolveAnalyticsEnvironment,
} from '../app/utils/analyticsLoadStrategy'

const PRODUCTION_HOST = 'example.com'

describe('isLocalAnalyticsHost', () => {
  it('matches localhost variants', () => {
    expect(isLocalAnalyticsHost('localhost')).toBe(true)
    expect(isLocalAnalyticsHost('127.0.0.1')).toBe(true)
    expect(isLocalAnalyticsHost('app.localhost')).toBe(true)
    expect(isLocalAnalyticsHost('myapp.local')).toBe(true)
  })

  it('does not match production or preview hosts', () => {
    expect(isLocalAnalyticsHost(PRODUCTION_HOST)).toBe(false)
    expect(isLocalAnalyticsHost('example.pages.dev')).toBe(false)
    expect(isLocalAnalyticsHost('example.workers.dev')).toBe(false)
  })
})

describe('isPreviewAnalyticsHost', () => {
  it('flags legacy Pages preview hosts', () => {
    expect(isPreviewAnalyticsHost('my-app.pages.dev')).toBe(true)
    expect(isPreviewAnalyticsHost('MY-APP.PAGES.DEV')).toBe(true)
  })

  it('flags Workers-first fleet preview aliases', () => {
    expect(isPreviewAnalyticsHost('bfe918b0-my-app.narduk-enterprises.workers.dev')).toBe(true)
  })

  it('does not flag the canonical production host', () => {
    expect(isPreviewAnalyticsHost(PRODUCTION_HOST)).toBe(false)
  })
})

describe('isInternalAnalyticsTraffic', () => {
  it('tags any non-production deployment target regardless of hostname', () => {
    expect(isInternalAnalyticsTraffic(PRODUCTION_HOST, 'staging')).toBe(true)
    expect(isInternalAnalyticsTraffic(PRODUCTION_HOST, 'preview')).toBe(true)
  })

  it('falls back to hostname classification when the deployment target is unset', () => {
    expect(isInternalAnalyticsTraffic('example.workers.dev', undefined)).toBe(true)
    expect(isInternalAnalyticsTraffic('example.pages.dev', undefined)).toBe(true)
  })

  it('does not tag production traffic on the canonical host', () => {
    expect(isInternalAnalyticsTraffic(PRODUCTION_HOST, 'production')).toBe(false)
    expect(isInternalAnalyticsTraffic(PRODUCTION_HOST, undefined)).toBe(false)
  })
})

describe('resolveAnalyticsEnvironment', () => {
  it('resolves development for local hosts regardless of deployment target', () => {
    expect(resolveAnalyticsEnvironment('localhost', 'production')).toBe('development')
  })

  it('resolves the explicit deployment target when non-production', () => {
    expect(resolveAnalyticsEnvironment(PRODUCTION_HOST, 'staging')).toBe('staging')
    expect(resolveAnalyticsEnvironment(PRODUCTION_HOST, 'preview')).toBe('preview')
  })

  it('falls back to preview for a workers.dev/pages.dev host with no deployment target', () => {
    expect(resolveAnalyticsEnvironment('example.workers.dev', undefined)).toBe('preview')
    expect(resolveAnalyticsEnvironment('example.pages.dev', undefined)).toBe('preview')
  })

  it('resolves production for the canonical host with no other signal', () => {
    expect(resolveAnalyticsEnvironment(PRODUCTION_HOST, 'production')).toBe('production')
    expect(resolveAnalyticsEnvironment(PRODUCTION_HOST, undefined)).toBe('production')
  })
})

describe('normalizeAnalyticsLoadStrategy', () => {
  it('accepts known strategies case-insensitively', () => {
    expect(normalizeAnalyticsLoadStrategy('IMMEDIATE')).toBe('immediate')
    expect(normalizeAnalyticsLoadStrategy('interaction')).toBe('interaction')
    expect(normalizeAnalyticsLoadStrategy('off')).toBe('off')
  })

  it('falls back to idle for unknown or non-string values', () => {
    expect(normalizeAnalyticsLoadStrategy('bogus')).toBe('idle')
    expect(normalizeAnalyticsLoadStrategy(undefined)).toBe('idle')
    expect(normalizeAnalyticsLoadStrategy(42)).toBe('idle')
  })
})
