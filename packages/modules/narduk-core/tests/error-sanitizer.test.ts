import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import { createHooks } from 'hookable'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyProductionErrorSanitizer,
  GENERIC_SERVER_ERROR_MESSAGE,
  prependNitroErrorHandler,
  readErrorRequestId,
  readPreviewSafeModeFlag,
  sanitizeProductionError,
  shouldSanitizeProductionError,
} from '../runtime/server/error-sanitizer'
import { installServerExceptionCapture } from '../runtime/shared/exception-capture'
import { onNardukException } from '../runtime/shared/exception-report'

import type {
  ProductionErrorSanitizerEvent,
  SanitizableServerError,
} from '../runtime/server/error-sanitizer'
import type { ExceptionHookHost, NardukExceptionReport } from '../runtime/shared/exception-report'

const NUXT_ERROR_HANDLER = '/node_modules/@nuxt/nitro-server/dist/runtime/handlers/error'
const SANITIZER_RUNTIME_PATH = '/runtime/server/error-sanitizer'

const config = vi.hoisted(() => ({
  current: { public: { previewSafeMode: false } } as {
    public?: { previewSafeMode?: boolean }
  },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => config.current,
  defineNitroPlugin: (plugin: unknown) => plugin,
}))

function leakyError(overrides: Partial<SanitizableServerError> = {}): SanitizableServerError {
  return Object.assign(new Error('D1_ERROR: no such table: users'), {
    statusCode: 500,
    statusMessage: 'SQLITE_ERROR: no such table: users',
    data: { binding: 'DB', sql: 'SELECT * FROM users' },
    cause: new Error('inner D1'),
    ...overrides,
  })
}

describe('production error sanitizer policy', () => {
  it('uses the same previewSafeMode flag error.vue reads from public runtime config', () => {
    expect(readPreviewSafeModeFlag({ public: { previewSafeMode: true } })).toBe(true)
    expect(readPreviewSafeModeFlag({ public: { previewSafeMode: false } })).toBe(false)
    expect(readPreviewSafeModeFlag({ public: {} })).toBe(false)
    expect(readPreviewSafeModeFlag(undefined)).toBe(false)
  })

  it('sanitizes 5xx and a missing status (SSR wrap defaults to 500), not 4xx', () => {
    expect(shouldSanitizeProductionError({ statusCode: 500 }, false, false)).toBe(true)
    expect(shouldSanitizeProductionError({ statusCode: 503 }, false, false)).toBe(true)
    expect(shouldSanitizeProductionError({}, false, false)).toBe(true)
    expect(shouldSanitizeProductionError({ statusCode: 404 }, false, false)).toBe(false)
    expect(shouldSanitizeProductionError({ statusCode: 400 }, false, false)).toBe(false)
    expect(shouldSanitizeProductionError({ statusCode: 500 }, true, false)).toBe(false)
  })

  it('does not sanitize 5xx while nuxt dev is running', () => {
    expect(shouldSanitizeProductionError({ statusCode: 500 }, false, true)).toBe(false)
  })

  it('coerces a string 4xx statusCode instead of treating it as 500', () => {
    expect(shouldSanitizeProductionError({ statusCode: '404' }, false, false)).toBe(false)
    expect(shouldSanitizeProductionError({ statusCode: '503' }, false, false)).toBe(true)
  })

  it('strips message, statusMessage, data, cause and stack in place', () => {
    const error = leakyError()
    error.stack = 'Error: D1_ERROR\n    at /app/server/db.ts:12'
    sanitizeProductionError(error, 'req-1234')

    expect(error.message).toBe(GENERIC_SERVER_ERROR_MESSAGE)
    expect(error.statusMessage).toBe(GENERIC_SERVER_ERROR_MESSAGE)
    expect(error.data).toBeUndefined()
    expect(error.cause).toBeUndefined()
    expect(error.stack).toBe('')
    expect(error.requestId).toBe('req-1234')
  })

  it('prefers the exception-capture request id on the event context', () => {
    const error = leakyError({ data: { requestId: 'from-data' }, requestId: 'from-error' })
    const event: ProductionErrorSanitizerEvent = { context: { _requestId: 'req-from-event' } }
    expect(readErrorRequestId(error, event)).toBe('req-from-event')
  })
})

describe('prepended Nitro errorHandler contract', () => {
  it('puts the sanitizer first so Nuxt still runs after it', () => {
    const nuxtHandler = NUXT_ERROR_HANDLER
    const builtin = '/node_modules/nitropack/dist/runtime/internal/error/prod'
    expect(prependNitroErrorHandler([nuxtHandler, builtin], SANITIZER_RUNTIME_PATH)).toEqual([
      SANITIZER_RUNTIME_PATH,
      nuxtHandler,
      builtin,
    ])
  })

  it('normalizes Nuxt string errorHandler into an array without dropping it', () => {
    expect(prependNitroErrorHandler(NUXT_ERROR_HANDLER, SANITIZER_RUNTIME_PATH)[0]).toBe(
      SANITIZER_RUNTIME_PATH,
    )
    expect(prependNitroErrorHandler(NUXT_ERROR_HANDLER, SANITIZER_RUNTIME_PATH)[1]).toBe(
      NUXT_ERROR_HANDLER,
    )
  })
})

describe('Nitro error handler', () => {
  beforeEach(() => {
    config.current = { public: { previewSafeMode: false } }
  })

  it('mutates a handled SSR 500 and returns without marking the event handled', () => {
    const error = leakyError()
    const event: ProductionErrorSanitizerEvent = {
      handled: false,
      context: { _requestId: 'req-1234' },
    }

    applyProductionErrorSanitizer(error, event, false)

    expect(event.handled).toBe(false)
    expect(error.message).toBe(GENERIC_SERVER_ERROR_MESSAGE)
    expect(error.statusMessage).toBe(GENERIC_SERVER_ERROR_MESSAGE)
    expect(error.data).toBeUndefined()
    expect(error.requestId).toBe('req-1234')
  })

  it('leaves a 4xx and a previewSafeMode 500 untouched', () => {
    const notFound = leakyError({ statusCode: 404, message: 'Station not found' })
    applyProductionErrorSanitizer(notFound, { context: {} }, false)
    expect(notFound.message).toBe('Station not found')
    expect(notFound.data).toEqual({ binding: 'DB', sql: 'SELECT * FROM users' })

    config.current = { public: { previewSafeMode: true } }
    const preview = leakyError()
    applyProductionErrorSanitizer(preview, { context: {} }, false)
    expect(preview.message).toBe('D1_ERROR: no such table: users')
    expect(preview.data).toEqual({ binding: 'DB', sql: 'SELECT * FROM users' })
  })

  it('keeps 4xx data when statusCode is the string 404', () => {
    const notFound = leakyError({
      statusCode: '404',
      message: 'Station not found',
      data: { reason: 'missing-station' },
    })
    applyProductionErrorSanitizer(notFound, { context: {} }, false)
    expect(notFound.message).toBe('Station not found')
    expect(notFound.data).toEqual({ reason: 'missing-station' })
  })

  it('leaves a leaky 500 intact in nuxt dev', () => {
    const error = leakyError()
    applyProductionErrorSanitizer(error, { context: {} }, true)
    expect(error.message).toBe('D1_ERROR: no such table: users')
    expect(error.data).toEqual({ binding: 'DB', sql: 'SELECT * FROM users' })
  })
})

describe('narduk:exception still receives the original error', () => {
  beforeEach(() => {
    config.current = { public: { previewSafeMode: false } }
  })

  it('captures before the sanitizer mutates, matching Nitro onError ordering', async () => {
    const nitro = { hooks: createHooks() }
    const reports: NardukExceptionReport[] = []
    onNardukException(nitro.hooks as unknown as ExceptionHookHost, (report) => reports.push(report))
    installServerExceptionCapture(nitro as never)

    const request = new IncomingMessage(new Socket())
    request.method = 'GET'
    request.url = '/stations'
    const event = createEvent(request, new ServerResponse(request))
    event.context._requestId = 'req-1234'
    event.context.matchedRoute = { path: '/stations', handlers: {} }

    const error = leakyError()
    // nitropack runtime/internal/app.mjs onError: captureError first (this hook),
    // then errorHandler (the sanitizer). hookable parallelTaskCaller invokes
    // hooks synchronously inside map(), so this report lands on the original.
    await nitro.hooks.callHook('error', error, { event, tags: ['request'] })

    applyProductionErrorSanitizer(error, event, false)

    expect(reports).toHaveLength(1)
    expect(reports[0]?.message).toBe('D1_ERROR: no such table: users')
    expect(reports[0]?.requestId).toBe('req-1234')
    expect(error.message).toBe(GENERIC_SERVER_ERROR_MESSAGE)
    expect(error.data).toBeUndefined()
  })
})

describe('module prepends the sanitizer on nitro:init', () => {
  it('registers the sanitizer path ahead of Nuxt handler after createNitro', async () => {
    const hooks = new Map<string, Array<(value: never) => void>>()
    vi.resetModules()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addPlugin: vi.fn(),
      addServerHandler: vi.fn(),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn(() => ({ filename: 'layout.vue' })),
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule: vi.fn(),
    }))

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = {
      options: {
        alias: {},
        app: {},
        appConfig: {},
        build: { transpile: [] },
        colorMode: {},
        css: [],
        devServer: {},
        future: {},
        icon: {},
        nitro: {},
        runtimeConfig: {},
        ui: {},
        vite: {},
      },
      hook(name: string, handler: (value: never) => void) {
        hooks.set(name, [...(hooks.get(name) || []), handler])
      },
    }

    await mod.setup({ app: true, coreModules: false, server: true }, nuxt)

    const nuxtHandler = NUXT_ERROR_HANDLER
    const builtin = '/node_modules/nitropack/dist/runtime/internal/error/prod'
    const nitro = { options: { errorHandler: [nuxtHandler, builtin] as string[] } }
    for (const handler of hooks.get('nitro:init') ?? []) {
      handler(nitro as never)
    }

    expect(nitro.options.errorHandler[0]).toMatch(/\/runtime\/server\/error-sanitizer$/)
    expect(nitro.options.errorHandler[1]).toBe(nuxtHandler)
    expect(nitro.options.errorHandler[2]).toBe(builtin)
    expect(nuxt.options.nitro).not.toEqual(
      expect.objectContaining({ errorHandler: expect.anything() }),
    )
  })
})
