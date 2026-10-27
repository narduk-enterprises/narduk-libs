// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAnalyticsContext } from '../app/utils/analyticsContext'
import { createAnalyticsTransport } from '../app/utils/analyticsTransport'
import { resetAnalyticsWarnings, warnAnalyticsOnce } from '../app/utils/analyticsWarnings'
import { createCaptureProvenance, resolveAnalyticsAppId } from '../server/utils/captureProvenance'
import { buildServerCaptureProvenance } from '../server/utils/posthog'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function transportFixture(
  options: Parameters<typeof createAnalyticsTransport>[0]['ttlMs'] = 30_000,
) {
  let now = 0
  const client = {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    register: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
  }
  const transport = createAnalyticsTransport({
    enabled: true,
    now: () => now,
    context: () => ({}),
    loadStrategy: 'interaction',
    ttlMs: options,
  })
  return { client, transport, time: (value: number) => (now = value) }
}

describe('provenance contract', () => {
  it('stamps registry app_id, site, build, SDK and schema versions and capture_origin', () => {
    const context = createAnalyticsContext({
      appId: 'riverstatus',
      appName: 'River',
      buildVersion: 'b1',
      hostname: 'River.example',
      sdkVersion: '1.32.0',
      owner: () => false,
      route: () => '/',
    })()
    expect(context).toMatchObject({
      app_id: 'riverstatus',
      site: 'River.example',
      build_version: 'b1',
      analytics_sdk_version: '1.32.0',
      analytics_schema_version: 1,
      capture_origin: 'browser',
    })
  })

  it('omits unknown build and SDK versions rather than inventing a value', () => {
    const provenance = createCaptureProvenance({ origin: 'browser', site: 'a.example' })
    expect(provenance).not.toHaveProperty('build_version')
    expect(provenance).not.toHaveProperty('analytics_sdk_version')
  })

  it('names the hostname fallback so it can be warned about', () => {
    expect(resolveAnalyticsAppId('', 'A.Example')).toEqual({
      appId: 'a.example',
      source: 'hostname',
    })
    expect(resolveAnalyticsAppId(' reg ', 'a.example')).toEqual({
      appId: 'reg',
      source: 'registry',
    })
  })

  it('warns once per key, and only when enabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resetAnalyticsWarnings()
    warnAnalyticsOnce(false, 'k', 'silent')
    warnAnalyticsOnce(true, 'k', 'first')
    warnAnalyticsOnce(true, 'k', 'again')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('first')
    warn.mockRestore()
  })

  it('gives server and synthetic captures the same keys with their own origin', () => {
    const config = {
      indexNowKey: '',
      ownerTagSecret: '',
      posthogOwnerDistinctId: '',
      posthogDomain: 'https://familystat.us',
      public: { analyticsAppId: 'familystat', buildVersion: 'b9', analyticsSdkVersion: '1.32.0' },
    }
    expect(buildServerCaptureProvenance(config)).toMatchObject({
      app_id: 'familystat',
      site: 'familystat.us',
      build_version: 'b9',
      analytics_sdk_version: '1.32.0',
      capture_origin: 'server',
    })
    expect(buildServerCaptureProvenance(config, undefined, 'synthetic').capture_origin).toBe(
      'synthetic',
    )
  })

  it('never configures cookieless or disabled persistence, so a kit pageview has a session', () => {
    const plugin = readFileSync(join(root, 'app/plugins/posthog.client.ts'), 'utf8')
    expect(plugin).not.toMatch(/cookieless_mode|disable_persistence|persistence:/u)
    expect(plugin).toMatch(/!import\.meta\.server/u)
  })

  it('seeds the package version and the estate ingest host from the module', () => {
    const module = readFileSync(join(root, 'src/module.ts'), 'utf8')
    expect(module).toMatch(/analyticsSdkVersion: readOwnVersion/u)
    expect(module).toMatch(/\|\| 'https:\/\/p\.nard\.uk'/u)
    expect(module).not.toContain('us.i.posthog.com')
    const plugin = readFileSync(join(root, 'app/plugins/posthog.client.ts'), 'utf8')
    expect(plugin).not.toContain('us.i.posthog.com')
    expect(plugin).toMatch(/posthogHost \? posthogHost : DEFAULT_POSTHOG_HOST/u)
  })
})

describe('deferred initialization (#1906)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('delivers a landing pageview 45 s later when the window is unbounded', () => {
    const f = transportFixture(Number.POSITIVE_INFINITY)
    f.transport.capture('$pageview')
    f.time(45_000)
    f.transport.attach(f.client)
    expect(f.client.capture).toHaveBeenCalledTimes(1)
    expect(f.client.capture.mock.calls[0]![1]).toMatchObject({
      analytics_queue_delay_ms: 45_000,
      analytics_load_strategy: 'interaction',
    })
    expect(f.transport.dropped).toBe(0)
  })

  it('expires only the stale captures and replays the rest', () => {
    const f = transportFixture()
    f.transport.capture('old')
    f.time(20_000)
    f.transport.capture('fresh')
    f.time(40_000)
    f.transport.attach(f.client)
    expect(f.client.capture.mock.calls.map((call) => call[0])).toEqual(['fresh'])
    expect(f.client.capture.mock.calls[0]![1]).toMatchObject({ analytics_queue_lost: 1 })
    expect(f.transport.diagnostics()).toMatchObject({
      expired: 1,
      sent: 1,
      lastReason: 'queue_expired',
    })
  })
})

describe('delivery diagnostics', () => {
  it('counts queued, sent, opted out and disabled with a reason, and carries no payload', () => {
    const f = transportFixture()
    f.transport.capture('secret-event', { email: 'a@b.example' })
    expect(f.transport.diagnostics()).toMatchObject({ queued: 1, sent: 0, status: 'pending' })
    f.client.has_opted_out_capturing.mockReturnValue(true)
    f.transport.attach(f.client)
    const snapshot = f.transport.diagnostics()
    expect(snapshot).toMatchObject({ optedOut: 1, lastReason: 'consent_opt_out' })
    expect(JSON.stringify(snapshot)).not.toContain('secret-event')
    expect(JSON.stringify(snapshot)).not.toContain('a@b.example')
    f.transport.disable()
    f.transport.capture('later')
    expect(f.transport.diagnostics()).toMatchObject({ disabled: 1, lastReason: 'disabled' })
  })

  it('counts events the plugin hook suppresses', () => {
    const f = transportFixture()
    f.transport.suppress('identity_pending')
    expect(f.transport.diagnostics()).toMatchObject({
      suppressed: 1,
      lastReason: 'identity_pending',
    })
  })
})
