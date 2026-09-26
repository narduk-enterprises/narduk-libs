import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * narduk-libs#1040: the narduk-auth module forces
 * `runtimeConfig.nardukSessionGrantRequired = true` at build time, but Nitro
 * lets `NUXT_NARDUK_SESSION_GRANT_REQUIRED=false` override it at runtime, and
 * nothing noticed. The validator plugin now refuses to start, and refuses each
 * request, while the resolved flag is anything but `true`. Cloudflare applies
 * env overrides per request, which is why the request check exists too.
 */

const state = vi.hoisted(() => ({
  bootConfig: {} as Record<string, unknown>,
  requestConfig: {} as Record<string, unknown>,
}))

const attachAuthSessionGrantValidator = vi.hoisted(() => vi.fn())

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: (event?: unknown) => (event ? state.requestConfig : state.bootConfig),
}))

vi.mock('../server/utils/session-grant-validator', () => ({
  attachAuthSessionGrantValidator,
}))

type RequestHook = (event: object) => void

async function boot(): Promise<RequestHook> {
  const { default: plugin } = await import('../server/plugins/00-session-grant-validator')
  let requestHook: RequestHook | undefined
  const nitroApp = {
    hooks: {
      hook: (name: string, hook: RequestHook) => {
        if (name === 'request') requestHook = hook
      },
    },
  }
  ;(plugin as unknown as (app: typeof nitroApp) => void)(nitroApp)
  if (!requestHook) throw new Error('the plugin registered no request hook')
  return requestHook
}

describe('nardukSessionGrantRequired cannot be disarmed (#1040)', () => {
  beforeEach(() => {
    vi.resetModules()
    attachAuthSessionGrantValidator.mockReset()
    state.bootConfig = { nardukSessionGrantRequired: true }
    state.requestConfig = { nardukSessionGrantRequired: true }
  })

  it('starts and attaches the validator when the flag is true', async () => {
    const onRequest = await boot()
    const event = {}
    onRequest(event)
    expect(attachAuthSessionGrantValidator).toHaveBeenCalledWith(event)
  })

  it.each([
    ['overridden to false', false],
    ['overridden to the string "false"', 'false'],
    ['removed', undefined],
  ])('refuses to start when the flag is %s', async (_label, value) => {
    state.bootConfig = { nardukSessionGrantRequired: value }
    await expect(boot()).rejects.toThrow(/nardukSessionGrantRequired/u)
  })

  it('refuses a request whose runtime config disarms the flag', async () => {
    const onRequest = await boot()
    state.requestConfig = { nardukSessionGrantRequired: false }
    expect(() => onRequest({})).toThrow(/nardukSessionGrantRequired/u)
    expect(attachAuthSessionGrantValidator).not.toHaveBeenCalled()
  })
})
