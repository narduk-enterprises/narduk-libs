// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import { installAnalyticsEngagement } from '../app/utils/analyticsEngagementBrowser'
import { createAnalyticsTransport } from '../app/utils/analyticsTransport'

describe('engagement browser lifecycle', () => {
  it('attributes navigation flushes to the previous visit and removes listeners on unmount', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const router = { currentRoute: { value: { path: '/first' } } }
    const client = {
      capture: vi.fn(),
      identify: vi.fn(),
      register: vi.fn(),
      reset: vi.fn(),
      has_opted_out_capturing: () => false,
    }
    const transport = createAnalyticsTransport({
      enabled: true,
      context: () => ({ route: router.currentRoute.value.path }),
    })
    transport.attach(client)
    let cleanup: (() => void) | undefined
    const tracker = installAnalyticsEngagement(transport, router, {
      onUnmount: (handler) => {
        cleanup = handler
      },
    })
    now = 5_000
    router.currentRoute.value = { path: '/second' }
    tracker.navigate()
    expect(client.capture).toHaveBeenLastCalledWith(
      'page_engagement',
      expect.objectContaining({ route: '/first', active_ms: 5_000 }),
      expect.any(Object),
    )
    now = 8_000
    window.dispatchEvent(new Event('pagehide'))
    expect(client.capture).toHaveBeenLastCalledWith(
      'page_engagement',
      expect.objectContaining({ route: '/second', active_ms: 3_000 }),
      expect.any(Object),
    )
    cleanup?.()
    const count = client.capture.mock.calls.length
    now = 10_000
    window.dispatchEvent(new Event('pagehide'))
    expect(client.capture).toHaveBeenCalledTimes(count)
    clock.mockRestore()
  })
})
