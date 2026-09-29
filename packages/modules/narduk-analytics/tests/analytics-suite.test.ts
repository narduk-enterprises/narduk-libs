import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { analyticsLandingAttribution } from '../app/utils/analyticsAttribution'
import { createAnalyticsContext } from '../app/utils/analyticsContext'
import { createAnalyticsEngagement } from '../app/utils/analyticsEngagement'
import {
  defineAnalyticsEvents,
  searchQueryLengthBucket,
  standardAnalyticsEvents,
} from '../app/utils/analyticsEvents'
import { createAnalyticsIdentity } from '../app/utils/analyticsIdentity'
import {
  createStandardPrivacyBeforeSend,
  createStrictPrivacyBeforeSend,
} from '../app/utils/analyticsPrivacy'
import { createAnalyticsTransport } from '../app/utils/analyticsTransport'

function fixture(enabled = true) {
  let now = 0
  let route = '/first'
  const client = {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    register: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
  }
  const transport = createAnalyticsTransport({
    enabled,
    now: () => now,
    context: () => ({ route, app_id: 'test', environment: 'production' }),
  })
  return {
    client,
    transport,
    time: (value: number) => {
      now = value
    },
    route: (value: string) => {
      route = value
    },
  }
}

describe('analytics transport', () => {
  it('clears persisted identity before replaying unresolved-session events', () => {
    const f = fixture()
    const transport = createAnalyticsTransport({
      enabled: true,
      context: () => ({}),
      resetOnAttach: true,
    })
    transport.capture('$pageview')
    transport.attach(f.client)
    expect(f.client.reset).toHaveBeenCalledTimes(1)
    expect(f.client.reset.mock.invocationCallOrder[0]).toBeLessThan(
      f.client.capture.mock.invocationCallOrder[0]!,
    )
  })

  it('fails closed if clearing persisted identity fails', () => {
    const f = fixture()
    f.client.reset.mockImplementation(() => {
      throw new Error('reset failed')
    })
    const transport = createAnalyticsTransport({
      enabled: true,
      context: () => ({}),
      resetOnAttach: true,
    })
    transport.capture('$pageview')
    transport.attach(f.client)
    expect(transport.status).toBe('failed')
    expect(f.client.capture).not.toHaveBeenCalled()
  })
  it('stops replay after a failed identity barrier', () => {
    const f = fixture()
    f.transport.identify('user')
    f.transport.capture('action')
    f.client.identify.mockImplementation(() => {
      throw new Error('invalid identity')
    })
    f.transport.attach(f.client)
    expect(f.client.capture).not.toHaveBeenCalled()
    expect(f.transport.status).toBe('failed')
  })

  it('preserves pending event context, timestamp and a snapshot of caller properties', () => {
    const f = fixture()
    const properties = { result_count: 1 }
    f.time(100)
    expect(f.transport.capture('search_completed', properties)).toBe(true)
    properties.result_count = 99
    f.route('/second')
    f.time(500)
    f.transport.attach(f.client)
    expect(f.client.capture).toHaveBeenCalledWith(
      'search_completed',
      { result_count: 1, route: '/first', app_id: 'test', environment: 'production' },
      { timestamp: new Date(100) },
    )
    expect(f.transport.status).toBe('ready')
  })

  it('preserves identity/reset ordering and reapplies context after reset', () => {
    const f = fixture()
    f.transport.identify('test:user-a')
    f.transport.capture('a')
    f.transport.reset()
    f.transport.identify('test:user-b')
    f.transport.capture('b')
    f.transport.attach(f.client)
    expect(f.client.identify.mock.invocationCallOrder[0]).toBeLessThan(
      f.client.capture.mock.invocationCallOrder[0]!,
    )
    expect(f.client.capture.mock.invocationCallOrder[0]).toBeLessThan(
      f.client.reset.mock.invocationCallOrder[0]!,
    )
    expect(f.client.reset.mock.invocationCallOrder[0]).toBeLessThan(
      f.client.identify.mock.invocationCallOrder[1]!,
    )
    expect(f.client.register).toHaveBeenCalledTimes(2)
  })

  it('never queues disabled capture and clears pending data when disabled', () => {
    const disabled = fixture(false)
    expect(disabled.transport.capture('a')).toBe(false)
    expect(disabled.transport.queued).toBe(0)
    const f = fixture()
    f.transport.capture('a')
    f.transport.disable()
    f.transport.attach(f.client)
    expect(f.client.capture).not.toHaveBeenCalled()
    expect(f.transport.queued).toBe(0)
  })

  it('discards the entire expired queue rather than skipping an identity barrier', () => {
    const f = fixture()
    f.transport.identify('a')
    f.time(30_001)
    f.transport.capture('a')
    f.transport.attach(f.client)
    expect(f.client.identify).not.toHaveBeenCalled()
    expect(f.client.capture).not.toHaveBeenCalled()
    expect(f.transport.dropped).toBe(2)
    expect(f.transport.status).toBe('failed')
    expect(f.transport.capture('later')).toBe(false)
  })

  it('fails closed on queue overflow without replaying a partial user history', () => {
    const f = fixture()
    for (let index = 0; index < 101; index++) f.transport.capture('a')
    expect(f.transport.status).toBe('failed')
    f.transport.attach(f.client)
    expect(f.client.capture).not.toHaveBeenCalled()
    expect(f.transport.dropped).toBe(101)
  })

  it('discards pending data when the attached SDK has opted out', () => {
    const f = fixture()
    f.transport.capture('a')
    f.client.has_opted_out_capturing.mockReturnValue(true)
    f.transport.attach(f.client)
    expect(f.client.capture).not.toHaveBeenCalled()
    expect(f.transport.capture('b')).toBe(false)
  })

  it('keeps SDK failures from breaking a product interaction', () => {
    const f = fixture()
    f.transport.attach(f.client)
    f.client.capture.mockImplementation(() => {
      throw new Error('offline')
    })
    expect(f.transport.capture('a')).toBe(false)
    expect(f.transport.dropped).toBe(1)
  })
})

describe('foreground engagement', () => {
  it('excludes idle and hidden time and emits non-overlapping deltas', () => {
    let now = 0
    const emit = vi.fn()
    const tracker = createAnalyticsEngagement({ emit, now: () => now, visitId: () => 'visit' })
    now = 50_000
    tracker.flush()
    tracker.flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenLastCalledWith('page_engagement', {
      active_ms: 30_000,
      page_visit_id: 'visit',
    })
    tracker.activity()
    now = 55_000
    tracker.visibility(false)
    now = 100_000
    tracker.flush()
    expect(emit).toHaveBeenCalledTimes(2)
    tracker.visibility(true)
    now = 103_000
    tracker.flush()
    expect(emit).toHaveBeenLastCalledWith('page_engagement', {
      active_ms: 3_000,
      page_visit_id: 'visit',
    })
  })

  it('emits four milestones once per visit and none for a non-scrollable or hidden page', () => {
    const emit = vi.fn()
    const tracker = createAnalyticsEngagement({ emit, now: () => 0, visitId: () => 'visit' })
    tracker.scroll(100, false)
    tracker.visibility(false)
    tracker.scroll(100, true)
    expect(emit).not.toHaveBeenCalled()
    tracker.visibility(true)
    tracker.scroll(100, true)
    tracker.scroll(100, true)
    expect(emit).toHaveBeenCalledTimes(4)
    tracker.navigate()
    tracker.scroll(25, true)
    expect(emit).toHaveBeenCalledTimes(5)
  })
})

describe('session identity', () => {
  it('clears a previously persisted person for an initial ready anonymous session', () => {
    const f = fixture()
    f.transport.attach(f.client)
    const synchronize = createAnalyticsIdentity(f.transport, 'app')
    synchronize(undefined)
    synchronize(undefined)
    expect(f.client.reset).toHaveBeenCalledTimes(1)
    expect(f.client.capture).not.toHaveBeenCalled()
  })
  it('identifies restored sessions without inventing login or signup events', () => {
    const f = fixture()
    f.transport.attach(f.client)
    const synchronize = createAnalyticsIdentity(f.transport, 'app')
    synchronize('opaque-a')
    synchronize('opaque-a')
    expect(f.client.identify).toHaveBeenCalledExactlyOnceWith('app:opaque-a', undefined)
    expect(f.client.capture).not.toHaveBeenCalled()
  })

  it('resets on account switches, logout, expiry and revocation', () => {
    const f = fixture()
    f.transport.attach(f.client)
    const synchronize = createAnalyticsIdentity(f.transport, 'app')
    synchronize(undefined)
    synchronize('a')
    synchronize('b')
    synchronize(null)
    synchronize(undefined)
    expect(f.client.reset).toHaveBeenCalledTimes(3)
    expect(f.client.identify.mock.calls.map((call) => call[0])).toEqual(['app:a', 'app:b'])
    expect(f.client.capture.mock.calls.map((call) => call[0])).toEqual([
      'auth_session_started',
      'auth_session_ended',
      'auth_session_started',
      'auth_session_ended',
    ])
  })

  it('rejects email and URL identifiers', () => {
    const f = fixture()
    f.transport.attach(f.client)
    const synchronize = createAnalyticsIdentity(f.transport, 'app')
    synchronize('private@example.com')
    synchronize('https://private.example/record')
    expect(f.client.identify).not.toHaveBeenCalled()
  })
})

describe('shared event contract and privacy', () => {
  it('captures bounded permitted document-entry attribution without private query values', () => {
    const href =
      'https://example.com/join?utm_source=newsletter&utm_medium=email&utm_campaign=autumn&email=private%40example.com&token=secret'
    const referrer = 'https://search.example/search?q=private'
    expect(analyticsLandingAttribution(href, referrer, false)).toEqual({
      landing_referrer_origin: 'https://search.example',
      landing_utm_source: 'newsletter',
      landing_utm_medium: 'email',
      landing_utm_campaign: 'autumn',
    })
    expect(analyticsLandingAttribution(href, referrer, true)).toEqual({
      landing_referrer_origin: 'https://search.example',
    })
    expect(analyticsLandingAttribution('invalid', '', false)).toEqual({})
  })

  const examples = {
    page_engagement: { active_ms: 10, page_visit_id: '12345678-1234-4123-8123-123456789abc' },
    scroll_depth_reached: { depth: 25, page_visit_id: '12345678-1234-4123-8123-123456789abc' },
    search_completed: { search_id: 'stations', query_length_bucket: '4-10', result_count: 4 },
    filter_changed: { filter_id: 'status', value: 'open' },
    sort_changed: { sort_id: 'stations', value: 'distance' },
    form_submitted: { form_id: 'signup' },
    form_succeeded: { form_id: 'signup' },
    form_failed: { form_id: 'signup', error_category: 'validation' },
    share_clicked: { action_id: 'share', channel: 'native' },
    clipboard_copied: { action_id: 'share' },
    file_downloaded: { action_id: 'report', file_type: 'csv' },
    outbound_link_clicked: { action_id: 'source', destination_host: 'example.com' },
    empty_state_shown: { state_id: 'results', reason: 'no_matches' },
    error_state_shown: { state_id: 'results', reason: 'unavailable' },
    auth_session_started: {},
    auth_session_ended: { reason: 'session_ended' },
    auth_signed_in: { method: 'passkey' },
    auth_signed_out: { reason: 'session_ended' },
    auth_signed_up: { method: 'email' },
  }
  it.each(Object.keys(standardAnalyticsEvents) as Array<keyof typeof standardAnalyticsEvents>)(
    '%s rejects extra private data and preserves its safe properties under both privacy modes',
    (event) => {
      const schema = standardAnalyticsEvents[event]
      const properties = examples[event]
      expect(schema.safeParse(properties).success).toBe(true)
      expect(schema.safeParse({ ...properties, email: 'private@example.com' }).success).toBe(false)
      const input = {
        event,
        properties: {
          ...properties,
          $current_url: 'https://example.com/items/private?token=secret#private',
          $el_text: 'Private record',
          utm_campaign: 'private_campaign',
          $session_entry_utm_campaign: 'private_campaign',
          $set_once: { $initial_utm_source: 'private_source' },
        },
      }
      const strict = createStrictPrivacyBeforeSend({
        origin: 'https://example.com',
        resolveRoute: () => ({ matched: [{ path: '/items/:id' }] }),
      })(input)
      const standard = createStandardPrivacyBeforeSend()(input)
      expect(JSON.stringify(strict)).not.toMatch(/private|secret|Private/u)
      expect(strict?.properties).toMatchObject(properties)
      expect(standard?.properties).toMatchObject(properties)
      expect(standard?.properties.$el_text).toBeUndefined()
      expect(standard?.properties.$current_url).not.toContain('token')
    },
  )

  it('rejects reserved/custom invalid event names', () => {
    expect(() => defineAnalyticsEvents({ $pageview: z.object({}) })).toThrow()
    expect(() => defineAnalyticsEvents({ form_succeeded: z.object({}) })).toThrow()
    expect(
      defineAnalyticsEvents({
        primary_action_completed: z.object({ source: z.enum(['map', 'list']) }).strict(),
      }),
    ).toHaveProperty('primary_action_completed')
    expect([0, 2, 8, 20, 40].map(searchQueryLengthBucket)).toEqual([
      'empty',
      '1-3',
      '4-10',
      '11-30',
      '31+',
    ])
  })

  it('preserves existing app labels and includes explicit false traffic flags', () => {
    const context = createAnalyticsContext({
      appName: 'GoNoGo Offshore',
      appId: 'gonogo',
      hostname: 'example.com',
      owner: () => false,
      route: () => '/places/:id',
      buildVersion: 'build',
    })()
    expect(context).toMatchObject({
      app: 'GoNoGo Offshore',
      app_id: 'gonogo',
      is_owner: false,
      is_internal_user: false,
      route: '/places/:id',
      build_version: 'build',
      surface: 'web',
    })
  })
})
