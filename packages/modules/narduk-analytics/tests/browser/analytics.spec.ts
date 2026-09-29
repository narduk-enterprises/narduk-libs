import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { ModuleKind, transpileModule } from 'typescript'

import { assertAnalyticsJourney } from '../../../../tooling/narduk-testkit/src/analytics'

import type * as PrivacyModule from '../../app/utils/analyticsPrivacy'
import type * as TransportModule from '../../app/utils/analyticsTransport'
import type { AnalyticsTransport } from '../../app/utils/analyticsTransport'
import type { PostHog } from 'posthog-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const sdk = readFileSync(resolve(dirname(require.resolve('posthog-js')), 'array.js'), 'utf8')
const origin = 'https://ops.example.test'

for (const strict of [false, true]) {
  test(`real SDK receives queued semantic events with ${strict ? 'strict' : 'standard'} privacy`, async ({
    page,
  }) => {
    const events: Array<{ event: string; properties: Record<string, unknown> }> = []
    await page.route(origin + '/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (pathname === '/sdk.js')
        return route.fulfill({ contentType: 'text/javascript', body: sdk })
      const sources: Record<string, string> = {
        '/transport.js': 'analyticsTransport',
        '/privacy.js': 'analyticsPrivacy',
        '/webVitals': 'webVitals',
      }
      const source = sources[pathname]
      if (source) {
        const code = readFileSync(resolve(root, 'app/utils', source + '.ts'), 'utf8')
        return route.fulfill({
          contentType: 'text/javascript',
          body: transpileModule(code, { compilerOptions: { module: ModuleKind.ESNext } })
            .outputText,
        })
      }
      if (request.method() === 'POST') {
        const raw = request.postData() ?? ''
        const parsed: unknown = JSON.parse(
          raw.startsWith('{') || raw.startsWith('[')
            ? raw
            : (new URLSearchParams(raw).get('data') ?? 'null'),
        )
        const batch = Array.isArray(parsed) ? parsed : [parsed]
        for (const event of batch) {
          if (event && typeof event === 'object' && 'event' in event)
            events.push(event as (typeof events)[number])
        }
        return route.fulfill({ contentType: 'application/json', body: '{"status":1}' })
      }
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Analytics fixture</title><button>Private record text</button>',
      })
    })
    await page.goto(origin + '/items/private?token=secret&utm_campaign=private_campaign')
    await page.addScriptTag({ url: origin + '/sdk.js' })
    const diagnostic = await page.evaluate(async (strictMode) => {
      const moduleUrl = window.location.origin + '/transport.js'
      const privacyUrl = window.location.origin + '/privacy.js'
      const { createAnalyticsTransport } = (await import(moduleUrl)) as typeof TransportModule
      const { createStrictPrivacyBeforeSend, createStandardPrivacyBeforeSend } = (await import(
        privacyUrl
      )) as typeof PrivacyModule
      const host = window as Window & { analyticsFixture?: AnalyticsTransport; posthog: PostHog }
      const transport = createAnalyticsTransport({
        enabled: true,
        context: () => ({
          app_id: 'fixture',
          route: '/items/:id',
          build_version: 'fixture-build',
          environment: 'production',
          is_owner: false,
          is_internal_user: false,
        }),
      })
      transport.capture('$pageview', { $current_url: window.location.href })
      transport.capture('form_submitted', { form_id: 'signup' })
      transport.capture('form_succeeded', { form_id: 'signup' })
      if (transport.queued !== 3)
        throw new Error('Pre-init events were dropped: ' + transport.dropped)
      const client = host.posthog.init('phc_fixture', {
        api_host: window.location.origin,
        // Playwright is automation: allow this synthetic collector fixture to receive events.
        opt_out_useragent_filter: true,
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        disable_session_recording: true,
        request_batching: false,
        disable_compression: true,
        ...(strictMode ? { cross_subdomain_cookie: false } : {}),
        before_send: strictMode
          ? createStrictPrivacyBeforeSend({
              origin: window.location.origin,
              resolveRoute: () => ({ matched: [{ path: '/items/:id' }] }),
            })
          : createStandardPrivacyBeforeSend(),
      })
      if (!client) throw new Error('SDK initialization failed')
      transport.attach(client)
      host.analyticsFixture = transport
      return {
        status: transport.status,
        dropped: transport.dropped,
        optedOut: client.has_opted_out_capturing(),
      }
    }, strict)
    expect(diagnostic).toEqual({ status: 'ready', dropped: 0, optedOut: false })
    await expect
      .poll(() => events.filter((event) => event.event === 'form_succeeded').length)
      .toBe(1)
    assertAnalyticsJourney(events, [
      { event: '$pageview', properties: { app_id: 'fixture', route: '/items/:id' }, count: 1 },
      { event: 'form_submitted', properties: { form_id: 'signup' }, count: 1 },
      {
        event: 'form_succeeded',
        properties: { form_id: 'signup', build_version: 'fixture-build' },
        count: 1,
      },
    ])
    expect(JSON.stringify(events)).not.toContain('secret')
    expect(JSON.stringify(events)).not.toContain('Private record text')
    if (strict) {
      expect(JSON.stringify(events)).not.toContain('private_campaign')
      expect(JSON.stringify(events)).not.toContain('/items/private')
      const cookies = await page.context().cookies()
      const analyticsCookies = cookies.filter((cookie) => cookie.name.startsWith('ph_'))
      expect(analyticsCookies.length).toBeGreaterThan(0)
      expect(analyticsCookies.every((cookie) => cookie.domain === 'ops.example.test')).toBe(true)
    }
    // Opt-out after initialization must stop subsequent semantic capture.
    await page.evaluate(() => {
      const host = window as Window & { analyticsFixture?: AnalyticsTransport; posthog: PostHog }
      host.posthog.opt_out_capturing()
      host.analyticsFixture?.capture('form_succeeded', { form_id: 'signup' })
    })
    expect(events.filter((event) => event.event === 'form_succeeded')).toHaveLength(1)
  })
}
