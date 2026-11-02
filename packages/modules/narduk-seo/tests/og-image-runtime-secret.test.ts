import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyRuntimeOgImageSigningSecret,
  isOgImageRequestPath,
  MISSING_OG_IMAGE_SECRET_MESSAGE,
  resolveRuntimeOgImageSigningSecret,
} from '../shared/ogImageSecret'

const RUNTIME_SECRET = 'runtime-worker-og-secret'

const logger = vi.hoisted(() => {
  const log = {
    child: vi.fn(() => log),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
  return log
})

vi.mock('@narduk-enterprises/narduk-core/server/utils/logger', () => ({
  useLogger: () => logger,
}))

interface StubbedEvent {
  context: { cloudflare?: { env?: Record<string, unknown> } }
  path: string
}

interface RuntimeConfigShape {
  app: { baseURL: string }
  'nuxt-og-image': { security: { secret?: string; strict?: boolean } }
  ogImage: { secret?: string }
}

/** The per-request copy a build with no secret produces (secret blanked). */
function blankRuntimeConfig(baseURL = '/'): RuntimeConfigShape {
  return {
    app: { baseURL },
    'nuxt-og-image': { security: { secret: '', strict: false } },
    ogImage: { secret: '' },
  }
}

/**
 * `ogImageRuntimeSecret.ts` relies on Nitro's ambient `defineEventHandler`,
 * `useRuntimeConfig` and `createError`. Stub them so the real handler runs;
 * `readWorkerRuntimeEnvValue` is narduk-core's real reader.
 */
function stubNitroGlobals(runtimeConfig: RuntimeConfigShape) {
  vi.stubGlobal('defineEventHandler', (handler: (event: StubbedEvent) => unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)
  vi.stubGlobal(
    'createError',
    (options: { statusCode: number; statusMessage: string }): Error & { statusCode: number } => {
      const error = new Error(options.statusMessage) as Error & { statusCode: number }
      error.statusCode = options.statusCode
      return error
    },
  )
}

async function loadHandler() {
  vi.resetModules()
  return (await import('../server/handlers/ogImageRuntimeSecret')).default as (
    event: StubbedEvent,
  ) => unknown
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('runtime OG signing secret resolution', () => {
  it('prefers the Worker binding, then the env overlay or baked key, then the module key', () => {
    const runtimeConfig = blankRuntimeConfig()
    expect(resolveRuntimeOgImageSigningSecret({ runtimeConfig, workerSecret: undefined })).toBe('')
    expect(
      resolveRuntimeOgImageSigningSecret({ runtimeConfig, workerSecret: RUNTIME_SECRET }),
    ).toBe(RUNTIME_SECRET)
    runtimeConfig['nuxt-og-image'].security.secret = 'baked-build-secret'
    expect(resolveRuntimeOgImageSigningSecret({ runtimeConfig, workerSecret: '  ' })).toBe(
      'baked-build-secret',
    )
    runtimeConfig.ogImage.secret = 'baked-build-secret'
    // A build that baked a secret still yields to a different runtime binding.
    expect(
      resolveRuntimeOgImageSigningSecret({ runtimeConfig, workerSecret: RUNTIME_SECRET }),
    ).toBe(RUNTIME_SECRET)
    expect(resolveRuntimeOgImageSigningSecret({ runtimeConfig, workerSecret: undefined })).toBe(
      'baked-build-secret',
    )
  })

  it('overwrites a whitespace-only baked secret with an empty one', () => {
    const runtimeConfig = blankRuntimeConfig()
    runtimeConfig.ogImage.secret = '   '
    runtimeConfig['nuxt-og-image'].security.secret = '   '
    expect(applyRuntimeOgImageSigningSecret({ runtimeConfig, workerSecret: undefined })).toBe('')
    expect(runtimeConfig.ogImage.secret).toBe('')
    expect(runtimeConfig['nuxt-og-image'].security.secret).toBe('')
  })

  it('writes one secret into both keys nuxt-og-image signs and verifies with', () => {
    const runtimeConfig = blankRuntimeConfig()
    expect(applyRuntimeOgImageSigningSecret({ runtimeConfig, workerSecret: RUNTIME_SECRET })).toBe(
      RUNTIME_SECRET,
    )
    expect(runtimeConfig.ogImage.secret).toBe(RUNTIME_SECRET)
    expect(runtimeConfig['nuxt-og-image'].security).toEqual({
      secret: RUNTIME_SECRET,
      strict: false,
    })
  })

  it('matches every nuxt-og-image route under the app base URL', () => {
    for (const path of ['/_og/d/a.png', '/_og/s/b.png', '/_og/r/x', '/_og/debug.json?x=1']) {
      expect(isOgImageRequestPath(path)).toBe(true)
      expect(isOgImageRequestPath(`/app${path}`, '/app/')).toBe(true)
    }
    for (const path of ['/', '/about', '/api/_og/x', '/_ogx/a.png']) {
      expect(isOgImageRequestPath(path)).toBe(false)
    }
  })
})

describe('ogImageRuntimeSecret middleware', () => {
  it('takes the secret from the Worker binding on the request', async () => {
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', '')
    const runtimeConfig = blankRuntimeConfig()
    stubNitroGlobals(runtimeConfig)
    const handler = await loadHandler()

    const event: StubbedEvent = {
      context: { cloudflare: { env: { NUXT_OG_IMAGE_SECRET: RUNTIME_SECRET } } },
      path: '/_og/d/w_1200,s_abc.png',
    }
    expect(handler(event)).toBeUndefined()
    expect(runtimeConfig.ogImage.secret).toBe(RUNTIME_SECRET)
    expect(runtimeConfig['nuxt-og-image'].security.secret).toBe(RUNTIME_SECRET)
  })

  it('takes the isolate env when a nested SSR fetch has no cloudflare context', async () => {
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', '')
    vi.stubGlobal('__env__', { NUXT_OG_IMAGE_SECRET: RUNTIME_SECRET })
    const runtimeConfig = blankRuntimeConfig()
    stubNitroGlobals(runtimeConfig)
    const handler = await loadHandler()

    expect(handler({ context: {}, path: '/' })).toBeUndefined()
    expect(runtimeConfig.ogImage.secret).toBe(RUNTIME_SECRET)
  })

  it('refuses /_og/ with 503 when the Worker has no secret, and logs once', async () => {
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', '')
    const runtimeConfig = blankRuntimeConfig()
    stubNitroGlobals(runtimeConfig)
    logger.error.mockClear()
    const handler = await loadHandler()

    const noSecret = { context: { cloudflare: { env: {} } } }
    expect(() => handler({ ...noSecret, path: '/_og/d/w_1200.png' })).toThrow(
      expect.objectContaining({ statusCode: 503 }),
    )
    expect(() => handler({ ...noSecret, path: '/_og/r/page' })).toThrow(
      expect.objectContaining({ statusCode: 503 }),
    )
    // A page still renders; with no secret its og:image URL is unsigned.
    expect(handler({ ...noSecret, path: '/about' })).toBeUndefined()
    expect(runtimeConfig['nuxt-og-image'].security.secret).toBe('')
    expect(runtimeConfig.ogImage.secret).toBe('')
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(MISSING_OG_IMAGE_SECRET_MESSAGE)
  })
})
