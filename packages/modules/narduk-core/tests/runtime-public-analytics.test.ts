import { describe, expect, it, vi } from 'vitest'

import { resolveRuntimePublicOverlay } from '../runtime/server/utils/runtime-public'

import type { H3Event } from 'h3'

const runtimeConfig = vi.hoisted(() => ({ current: { public: {} } as Record<string, unknown> }))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => runtimeConfig.current,
}))

function event(env: Record<string, string> = {}): H3Event {
  return { context: { cloudflare: { env } } } as unknown as H3Event
}

describe('runtime-public analytics defaults', () => {
  it('keeps session replay off unless the build or Worker overlay explicitly opts in', () => {
    runtimeConfig.current = { public: {} }
    expect(resolveRuntimePublicOverlay(event()).posthogSessionReplayEnabled).toBe(false)
    expect(
      resolveRuntimePublicOverlay(event({ POSTHOG_SESSION_REPLAY_ENABLED: 'false' }))
        .posthogSessionReplayEnabled,
    ).toBe(false)
    expect(
      resolveRuntimePublicOverlay(event({ POSTHOG_SESSION_REPLAY_ENABLED: 'true' }))
        .posthogSessionReplayEnabled,
    ).toBe(true)

    runtimeConfig.current = { public: { posthogSessionReplayEnabled: true } }
    expect(resolveRuntimePublicOverlay(event()).posthogSessionReplayEnabled).toBe(true)
    expect(
      resolveRuntimePublicOverlay(event({ POSTHOG_SESSION_REPLAY_ENABLED: 'false' }))
        .posthogSessionReplayEnabled,
    ).toBe(false)
  })
})
