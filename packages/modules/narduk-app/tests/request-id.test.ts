import { createApp, createError, eventHandler, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'

import requestIdErrorHandler from '../src/server/request-id-error-handler'
import {
  applyRequestId,
  installRequestId,
  resolveRequestId,
  stampRequestId,
} from '../src/server/request-id'

import type { H3Error } from 'h3'

// Mirrors the body shape of nitropack's default error handler (internal/error/prod).
const defaultHandler = (error: H3Error) => {
  const sensitive = Boolean(error.unhandled || error.fatal)
  const statusCode = error.statusCode || 500
  const statusMessage = error.statusMessage || 'Server Error'
  return {
    status: statusCode,
    statusText: statusMessage,
    headers: { 'content-type': 'application/json' },
    body: {
      error: true,
      statusCode,
      statusMessage,
      message: sensitive ? 'Server Error' : error.message,
      data: sensitive ? undefined : error.data,
    },
  }
}

const headers = (h: Record<string, string>) => (name: string) => h[name]

describe('resolveRequestId', () => {
  it('prefers cf-ray, then a well-formed x-request-id, then a random id', () => {
    expect(
      resolveRequestId(headers({ 'cf-ray': '8a1b2c3d4e5f-AUS', 'x-request-id': 'caller-1' })),
    ).toBe('8a1b2c3d4e5f-AUS')
    expect(resolveRequestId(headers({ 'x-request-id': 'caller-1' }))).toBe('caller-1')
    expect(resolveRequestId(headers({}), () => 'rand-1')).toBe('rand-1')
  })

  it('refuses a header that could smuggle markup or run long', () => {
    expect(resolveRequestId(headers({ 'x-request-id': '<script>' }), () => 'rand-2')).toBe('rand-2')
    expect(resolveRequestId(headers({ 'x-request-id': 'a'.repeat(129) }), () => 'rand-3')).toBe(
      'rand-3',
    )
  })

  it('generates a uuid by default', () => {
    expect(resolveRequestId(headers({}))).toMatch(/^[\da-f-]{36}$/)
  })
})

describe('stampRequestId', () => {
  it('adds requestId to an object body and leaves a string or array alone', () => {
    expect(stampRequestId({ statusCode: 409 }, 'r1')).toEqual({ statusCode: 409, requestId: 'r1' })
    expect(stampRequestId('Redirecting...', 'r1')).toBe('Redirecting...')
    expect(stampRequestId([1], 'r1')).toEqual([1])
  })
})

describe('applyRequestId', () => {
  it('sets the response header and event.context.requestId', async () => {
    const app = createApp()
    app.use(
      eventHandler((event) => {
        applyRequestId(event)
        return { seen: event.context.requestId }
      }),
    )
    const response = await toWebHandler(app)(
      new Request('https://x.test/', { headers: { 'x-request-id': 'caller-9' } }),
    )
    expect(response.headers.get('x-request-id')).toBe('caller-9')
    expect(await response.json()).toEqual({ seen: 'caller-9' })
  })

  it('installs on the Nitro request hook', () => {
    let registered = ''
    installRequestId({
      hooks: {
        hook(name) {
          registered = name
        },
      },
    })
    expect(registered).toBe('request')
  })
})

describe('the error handler', () => {
  const fetchError = async (path: string, thrown: unknown, requestId: string | undefined) => {
    const app = createApp({
      onRequest: (event) => {
        if (requestId) event.context.requestId = requestId
      },
      onError: (error, event) =>
        requestIdErrorHandler(error, event, { defaultHandler: defaultHandler as never }),
    })
    app.use(
      eventHandler(() => {
        throw thrown
      }),
    )
    return toWebHandler(app)(new Request(`https://x.test${path}`))
  }

  it('puts requestId in an apiError-shaped body and in an unhandled 500 body', async () => {
    const refusal = await fetchError(
      '/api/orders',
      createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: 'Bay is taken.',
        data: { code: 'bay_occupied' },
      }),
      'ray-7',
    )
    expect(refusal.status).toBe(409)
    expect(await refusal.json()).toMatchObject({
      statusCode: 409,
      message: 'Bay is taken.',
      data: { code: 'bay_occupied' },
      requestId: 'ray-7',
    })
    const crash = await fetchError('/api/orders', new Error('d1 exploded'), 'ray-7')
    expect(crash.status).toBe(500)
    expect(await crash.json()).toMatchObject({
      statusCode: 500,
      message: 'Server Error',
      requestId: 'ray-7',
    })
  })

  it('leaves page errors and requests with no id to the next handler', async () => {
    const page = await fetchError('/orders/1', createError({ statusCode: 404 }), 'ray-7')
    expect(await page.text()).not.toContain('ray-7')
    const unnamed = await fetchError('/api/orders', createError({ statusCode: 404 }), undefined)
    expect(await unnamed.text()).not.toContain('requestId')
  })
})
