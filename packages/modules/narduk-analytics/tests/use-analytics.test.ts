import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { useAnalytics } from '../app/composables/useAnalytics'
import { defineAnalyticsEvents } from '../app/utils/analyticsEvents'
import { createAnalyticsTransport } from '../app/utils/analyticsTransport'

import { __setFixtureNuxtApp } from './fixtures/nuxt-imports'

beforeEach(() => __setFixtureNuxtApp({}))

describe('typed analytics API', () => {
  it('fails typecheck for unknown names or private/incorrect shared properties', () => {
    const api = useAnalytics()
    // @ts-expect-error Unknown shared event name must not compile.
    expect(api.capture('unknown_event', {})).toBe(false)
    // @ts-expect-error Shared search has no query text property.
    expect(api.capture('search_completed', { query: 'private' })).toBe(false)
    expect(
      api.capture('search_completed', {
        search_id: 'stations',
        query_length_bucket: 'empty',
        // @ts-expect-error A count is numeric, not freeform text.
        result_count: 'private',
      }),
    ).toBe(false)
    expect(api.status).toBe('disabled')
  })

  it('validates an app catalog at runtime and queues typed events before the SDK is ready', () => {
    const transport = createAnalyticsTransport({
      enabled: true,
      context: () => ({ route: '/map' }),
    })
    __setFixtureNuxtApp({ $analytics: transport })
    const catalog = defineAnalyticsEvents({
      primary_action_completed: z.object({ source: z.enum(['map', 'list']) }).strict(),
    })
    const api = useAnalytics(catalog)
    expect(api.capture('primary_action_completed', { source: 'map' })).toBe(true)
    // @ts-expect-error Product catalog property enum is checked at compile time.
    expect(api.capture('primary_action_completed', { source: 'private' })).toBe(false)
    expect(api.status).toBe('pending')
    expect(transport.queued).toBe(1)
  })
})
