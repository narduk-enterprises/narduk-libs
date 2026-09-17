import { createServer } from 'node:http'

import { createApp, createRouter, toNodeListener } from 'h3'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'

import { createRateLimitWindowStore } from '../runtime/server/rate-limit/window'
import { defineRateLimitedHandler } from '../runtime/server/utils/rateLimitedHandler'
import { defineValidatedHandler } from '../runtime/server/utils/validatedHandler'

import type { ValidationErrorData } from '../runtime/server/utils/validatedHandler'
import type { EventHandler, H3Event } from 'h3'

/**
 * The wrapper logs a broken response contract through narduk-logging, which
 * needs a booted Nitro server to resolve a request-local logger. The local
 * `logger` module is the seam: mocking it proves what this code logs, and lets
 * one test make logging itself fail.
 */
const { logger } = vi.hoisted(() => ({
  logger: {
    calls: [] as Array<{ data?: Record<string, unknown>; message: string }>,
    throws: false,
  },
}))

vi.mock('../runtime/server/utils/logger', async (importOriginal) => ({
  // Partial: `defineRateLimitedHandler` reaches for `ensureRequestId` from the
  // same module, and the composition tests run it for real.
  ...(await importOriginal<Record<string, unknown>>()),
  useLogger: () => {
    if (logger.throws) throw new Error('no request-local logger')
    return {
      debug: () => {},
      error: (message: string, data?: Record<string, unknown>) => {
        logger.calls.push({ data, message })
      },
      info: () => {},
      warn: () => {},
    }
  },
}))

/** `defineRateLimitedHandler` reads its defaults from Nitro's runtime config. */
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))

interface FetchResult {
  body: string
  status: number
}

interface RequestOptions {
  body?: BodyInit
  headers?: Record<string, string>
  method?: string
  /** An h3 route template (`/api/stations/:stationId`) when params matter. */
  route?: string
}

/**
 * Drive the handler over a real h3 app on a real socket.
 *
 * A mocked event would prove what this code does to an object; a live request
 * proves the status line and the JSON body a client actually receives — which
 * is the whole question for every failure path here, because those responses
 * are produced by h3's error handler rather than by the handler's own return.
 */
async function request(
  handler: EventHandler,
  path: string,
  options: RequestOptions = {},
): Promise<FetchResult> {
  const app = createApp()
  if (options.route) {
    const router = createRouter()
    router.use(options.route, handler)
    app.use(router)
  } else {
    app.use('/', handler, { match: () => true })
  }

  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      body: options.body,
      // Node's fetch needs this to send a body it cannot measure up front.
      duplex: 'half',
      headers: options.headers,
      method: options.method ?? 'GET',
    } as RequestInit)
    return { body: await response.text(), status: response.status }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

function issuesOf(result: FetchResult): ValidationErrorData['issues'] {
  const parsed = JSON.parse(result.body) as { data?: ValidationErrorData }
  expect(parsed.data?.code).toBe('VALIDATION_FAILED')
  return parsed.data?.issues ?? []
}

function json(value: unknown): RequestOptions {
  return {
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }
}

const GREET = '/api/greet'
const THING = '/api/thing'
const SEARCH = '/api/search'

const searchQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().default(''),
})

describe('defineValidatedHandler', () => {
  beforeEach(() => {
    logger.calls = []
    logger.throws = false
  })

  describe('request parsing', () => {
    it('hands the handler the parsed query, with defaults applied', async () => {
      const handler = defineValidatedHandler({
        handler: ({ query }) => ({ seen: query }),
        query: searchQuery,
      })

      const result = await request(handler, `${SEARCH}?q=buoy&limit=5`)

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ seen: { limit: 5, q: 'buoy' } })
    })

    it('hands the handler the parsed route params', async () => {
      const handler = defineValidatedHandler({
        handler: ({ params }) => ({ station: params.stationId }),
        params: z.object({ stationId: z.string().min(1) }),
      })

      const result = await request(handler, '/api/stations/41008', {
        route: '/api/stations/:stationId',
      })

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ station: '41008' })
    })

    it('hands the handler the parsed JSON body', async () => {
      const handler = defineValidatedHandler({
        body: z.object({ name: z.string() }),
        handler: ({ body }) => ({ greeted: body.name }),
      })

      const result = await request(handler, GREET, json({ name: 'buoy' }))

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ greeted: 'buoy' })
    })

    it('leaves an undeclared part undefined instead of reading it', async () => {
      const handler = defineValidatedHandler({
        handler: ({ body, params, query }) => ({
          body: body ?? null,
          params: params ?? null,
          query: query ?? null,
        }),
      })

      const result = await request(handler, '/api/anything?q=ignored')

      expect(JSON.parse(result.body)).toEqual({ body: null, params: null, query: null })
    })
  })

  describe('rejecting a bad request', () => {
    it('answers 400 naming every bad field across params and query at once', async () => {
      const handler = defineValidatedHandler({
        handler: () => ({ ok: true }),
        params: z.object({ stationId: z.string().min(6) }),
        query: z.object({
          limit: z.coerce.number().int().max(10),
          mode: z.enum(['raw', 'hourly']),
        }),
      })

      const result = await request(handler, '/api/stations/41?limit=99&mode=weekly', {
        route: '/api/stations/:stationId',
      })

      expect(result.status).toBe(400)
      expect(
        issuesOf(result)
          .map((issue) => issue.path)
          .sort(),
      ).toEqual(['params.stationId', 'query.limit', 'query.mode'])
    })

    it('never echoes a submitted value back to the caller', async () => {
      const handler = defineValidatedHandler({
        body: z.strictObject({
          mode: z.enum(['raw', 'hourly']),
          name: z.string(),
        }),
        handler: () => ({ ok: true }),
      })

      const result = await request(
        handler,
        GREET,
        json({ mode: 'hunter2-mode', name: 42, password: 'hunter2-secret' }),
      )

      expect(result.status).toBe(400)
      expect(result.body).not.toContain('hunter2-mode')
      expect(result.body).not.toContain('hunter2-secret')
      // The rejected *key* survives, as a path segment — that is what makes the
      // error actionable — but never as prose, and never with its value.
      expect(issuesOf(result)).toContainEqual({
        message: 'Unrecognized key',
        path: 'body.password',
      })
    })

    it('does not read the body when params or query already failed', async () => {
      const handler = defineValidatedHandler({
        body: z.object({ name: z.string() }),
        handler: () => ({ ok: true }),
        query: z.object({ limit: z.coerce.number().max(10) }),
      })

      const result = await request(handler, `${GREET}?limit=99`, {
        // Unparseable on purpose: a body issue in the response would prove the
        // payload was touched before the query verdict was in.
        body: '{ not json at all',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      expect(result.status).toBe(400)
      expect(issuesOf(result).map((issue) => issue.path)).toEqual(['query.limit'])
    })

    it('answers 400 with a body path when the payload is not valid JSON', async () => {
      const handler = defineValidatedHandler({
        body: z.object({ name: z.string() }),
        handler: () => ({ ok: true }),
      })

      const result = await request(handler, GREET, {
        body: '{ not json at all',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      expect(result.status).toBe(400)
      expect(issuesOf(result)).toEqual([{ message: 'Body is not valid JSON', path: 'body' }])
    })

    it('answers 400 when a method that carries no body declares a body schema', async () => {
      const handler = defineValidatedHandler({
        body: z.object({ name: z.string() }),
        handler: () => ({ ok: true }),
      })

      const result = await request(handler, GREET)

      expect(result.status).toBe(400)
      expect(issuesOf(result).map((issue) => issue.path)).toEqual(['body'])
    })

    it('accepts a missing body on a bodyless method when the schema allows it', async () => {
      const handler = defineValidatedHandler({
        body: z.object({ name: z.string() }).optional(),
        handler: ({ body }) => ({ body: body ?? null }),
      })

      const result = await request(handler, GREET)

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ body: null })
    })
  })

  describe('bounding the body', () => {
    const handler = defineValidatedHandler({
      body: z.object({ name: z.string() }),
      handler: ({ body }) => ({ greeted: body.name }),
      maxBodyBytes: 64,
    })

    it('answers 413 on a declared length over the ceiling', async () => {
      const result = await request(handler, GREET, json({ name: 'b'.repeat(200) }))

      expect(result.status).toBe(413)
      // A bare h3 app drops `message` from the serialized error, so the ceiling
      // is asserted where every runtime agrees it survives: `data`.
      expect((JSON.parse(result.body) as { data?: unknown }).data).toEqual({
        code: 'BODY_TOO_LARGE',
        maxBodyBytes: 64,
      })
    })

    it('answers 413 on an undeclared length over the ceiling', async () => {
      const payload = JSON.stringify({ name: 'b'.repeat(200) })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload))
          controller.close()
        },
      })

      const result = await request(handler, GREET, {
        // A stream body is sent chunked, so no `content-length` reaches the
        // server and the ceiling has to be enforced after the read.
        body: stream,
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      expect(result.status).toBe(413)
    })

    it('accepts a body under the ceiling', async () => {
      const result = await request(handler, GREET, json({ name: 'buoy' }))

      expect(result.status).toBe(200)
    })

    it('answers 415 when the body is not sent as JSON', async () => {
      const result = await request(handler, GREET, {
        body: 'name=buoy',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      })

      expect(result.status).toBe(415)
      expect((JSON.parse(result.body) as { data?: unknown }).data).toEqual({
        code: 'UNSUPPORTED_MEDIA_TYPE',
      })
    })
  })

  describe('checking the response', () => {
    const contract = z.object({ ok: z.boolean() })

    function broken(validateResponse?: boolean | number) {
      return defineValidatedHandler({
        handler: () => ({ ok: 'not-a-boolean' }) as unknown as { ok: boolean },
        response: contract,
        validateResponse,
      })
    }

    it('answers 500 and logs when the route breaks its own contract', async () => {
      const result = await request(broken(true), THING)

      expect(result.status).toBe(500)
      expect(logger.calls).toHaveLength(1)
      expect(logger.calls[0]!.message).toBe('Response validation failed')
      expect(logger.calls[0]!.data?.issues).toEqual([
        { message: 'Invalid input: expected boolean, received string', path: 'response.ok' },
      ])
    })

    it('names the offending path in development and test', async () => {
      const result = await request(broken(true), THING)

      expect(result.body).toContain('response.ok')
    })

    it('stays an opaque 500 in production', async () => {
      vi.stubEnv('MODE', 'production')
      try {
        const result = await request(broken(true), THING)

        expect(result.status).toBe(500)
        expect(result.body).not.toContain('response.ok')
        expect(logger.calls).toHaveLength(1)
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('still answers 500 when logging itself fails', async () => {
      logger.throws = true

      const result = await request(broken(true), THING)

      expect(result.status).toBe(500)
    })

    it('checks by default in test, and not by default in production', async () => {
      expect((await request(broken(), THING)).status).toBe(500)

      // `vi.stubEnv` rewrites `import.meta.env` too, which is the build-time
      // flag the wrapper reads — a deployed Worker defines none of them.
      vi.stubEnv('MODE', 'production')
      try {
        expect((await request(broken(), THING)).status).toBe(200)
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('treats a sampling rate as the share of requests it checks', async () => {
      expect((await request(broken(0), THING)).status).toBe(200)
      expect((await request(broken(1), THING)).status).toBe(500)

      const random = vi.spyOn(Math, 'random')
      try {
        random.mockReturnValue(0.9)
        expect((await request(broken(0.5), THING)).status).toBe(200)

        random.mockReturnValue(0.1)
        expect((await request(broken(0.5), THING)).status).toBe(500)
      } finally {
        random.mockRestore()
      }
    })

    it('asserts rather than reshapes: the handler value reaches the client intact', async () => {
      const handler = defineValidatedHandler({
        // A non-strict object would silently drop `extra` if the schema were
        // used to parse the outgoing value. It is a check, so `extra` survives.
        handler: () => ({ extra: 'kept', ok: true }),
        response: contract,
        validateResponse: true,
      })

      const result = await request(handler, THING)

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ extra: 'kept', ok: true })
    })
  })

  describe('composing with defineRateLimitedHandler', () => {
    function composed() {
      return defineRateLimitedHandler(
        defineValidatedHandler({
          handler: ({ query }) => ({ seen: query.q }),
          query: z.object({ q: z.string().min(1) }),
        }),
        { key: 'validated-compose', limit: 1, store: createRateLimitWindowStore() },
      )
    }

    it('validates inside the allowance', async () => {
      const handler = composed()

      expect(JSON.parse((await request(handler, `${SEARCH}?q=buoy`)).body)).toEqual({
        seen: 'buoy',
      })
    })

    it('rejects an invalid request with 400 while the allowance holds', async () => {
      expect((await request(composed(), `${SEARCH}?q=`)).status).toBe(400)
    })

    it('throttles before it validates, so a spent allowance answers 429 not 400', async () => {
      const handler = composed()

      expect((await request(handler, `${SEARCH}?q=buoy`)).status).toBe(200)
      // Second request: over the limit *and* invalid. The rate limit is the
      // outer wrapper, so it answers first and the schemas never run.
      expect((await request(handler, `${SEARCH}?q=`)).status).toBe(429)
    })
  })

  describe('types', () => {
    it('infers every declared part into the handler and the route result', () => {
      const handler = defineValidatedHandler({
        body: z.object({ name: z.string() }),
        handler: (context) => {
          expectTypeOf(context.event).toEqualTypeOf<H3Event>()
          expectTypeOf(context.body).toEqualTypeOf<{ name: string }>()
          expectTypeOf(context.params).toEqualTypeOf<{ stationId: string }>()
          expectTypeOf(context.query).toEqualTypeOf<{ limit: number; q: string }>()
          return { ok: true }
        },
        params: z.object({ stationId: z.string() }),
        query: searchQuery,
        response: z.object({ ok: z.boolean() }),
      })

      expectTypeOf(handler).returns.resolves.toEqualTypeOf<{ ok: boolean }>()
      expect(handler).toBeTypeOf('function')
    })

    it('leaves an undeclared part undefined and infers a free-form result', () => {
      const handler = defineValidatedHandler({
        handler: (context) => {
          expectTypeOf(context.body).toEqualTypeOf<undefined>()
          expectTypeOf(context.params).toEqualTypeOf<undefined>()
          expectTypeOf(context.query).toEqualTypeOf<undefined>()
          return { station: '41008' }
        },
      })

      expectTypeOf(handler).returns.resolves.toEqualTypeOf<{ station: string }>()
      expect(handler).toBeTypeOf('function')
    })

    it('rejects a handler that breaks the declared response shape', () => {
      // The `@ts-expect-error` is the assertion: `nuxt typecheck` reads this
      // file, and an unused directive is itself an error.
      const handler = defineValidatedHandler({
        // @ts-expect-error `ok` is declared as a boolean by the response schema.
        handler: () => ({ ok: 'yes' }),
        response: z.object({ ok: z.boolean() }),
      })

      expect(handler).toBeTypeOf('function')
    })
  })
})
