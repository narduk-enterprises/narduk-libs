import { describe, expect, it, vi } from 'vitest'

import { resolveRuntimePublicOverlay } from '../runtime/server/utils/runtime-public'

import type { H3Event } from 'h3'

const runtimeConfig = vi.hoisted(() => ({ current: { public: {} } as Record<string, unknown> }))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => runtimeConfig.current,
}))

function event(env: Record<string, string> = {}, host = 'app.example'): H3Event {
  return {
    node: { req: { headers: { host }, url: '/api/runtime/public', socket: {} } },
    path: '/api/runtime/public',
    context: { cloudflare: { env } },
  } as unknown as H3Event
}

describe('runtime-public analytics defaults', () => {
  it('suppresses analytics on preview hosts while preserving the same version on its canonical host', () => {
    runtimeConfig.current = { public: { appUrl: 'https://app.example' } }
    const env = {
      NARDUK_DEPLOY_TARGET: 'production',
      GA_MEASUREMENT_ID: 'G-TEST',
      POSTHOG_PUBLIC_KEY: 'public-test-key',
      POSTHOG_SESSION_REPLAY_ENABLED: 'true',
    }
    for (const host of ['alias-worker.account.workers.dev', 'branch.app.pages.dev']) {
      expect(resolveRuntimePublicOverlay(event(env, host))).toMatchObject({
        deploymentTarget: 'preview',
        previewSafeMode: true,
        analyticsLoadStrategy: 'off',
        gaMeasurementId: '',
        posthogPublicKey: '',
        posthogSessionReplayEnabled: false,
      })
    }
    expect(resolveRuntimePublicOverlay(event(env))).toMatchObject({
      deploymentTarget: 'production',
      previewSafeMode: false,
      analyticsLoadStrategy: 'idle',
      gaMeasurementId: 'G-TEST',
      posthogPublicKey: 'public-test-key',
      posthogSessionReplayEnabled: true,
    })
  })

  it('keeps explicit staging and safe-mode deployments off on a custom hostname', () => {
    runtimeConfig.current = {
      public: { gaMeasurementId: 'G-TEST', posthogPublicKey: 'public-test-key' },
    }
    const previewEnvironments: Array<Record<string, string>> = [
      { NARDUK_DEPLOY_TARGET: 'staging' },
      { NARDUK_PREVIEW_SAFE_MODE: 'true' },
    ]
    for (const env of previewEnvironments) {
      expect(resolveRuntimePublicOverlay(event(env))).toMatchObject({
        previewSafeMode: true,
        analyticsLoadStrategy: 'off',
        gaMeasurementId: '',
        posthogPublicKey: '',
      })
    }
  })

  it('preserves an explicitly canonical workers.dev production site', () => {
    runtimeConfig.current = {
      public: { appUrl: 'https://app.account.workers.dev', gaMeasurementId: 'G-TEST' },
    }
    expect(resolveRuntimePublicOverlay(event({}, 'app.account.workers.dev'))).toMatchObject({
      deploymentTarget: 'production',
      previewSafeMode: false,
      gaMeasurementId: 'G-TEST',
    })
  })

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
