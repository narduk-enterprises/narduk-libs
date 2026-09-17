import { sendError } from 'h3'

import { createFakeEvent, readFakeEventResponse } from './fake-event.js'

import type { FakeEventOptions, FakeHandlerResponse } from './fake-event.js'
import type { EventHandler, H3Event } from 'h3'

/**
 * Options for {@link callHandler}.
 */
export interface CallHandlerOptions {
  /**
   * Cloudflare bindings, wired onto `event.context.cloudflare.env` the way
   * Nitro's Cloudflare preset does — pass the fakes from `fake-kv`,
   * `fake-r2`, and `fake-d1` here under the binding names the handler reads.
   */
  env?: Record<string, unknown>
}

/**
 * Call an h3 event handler against a {@link createFakeEvent}-built event and
 * read back its response, wiring `env` onto `event.context.cloudflare.env`
 * for handlers that call `useKV`/`useDatabase`/a raw binding lookup.
 *
 * A thrown error is converted into the same response `sendError` would
 * produce in a real Nitro app (this is what a production deployment does
 * for an uncaught handler error), rather than rejecting the returned
 * promise — a test that wants to assert on the thrown error object itself
 * should build the event with {@link createFakeEvent} and call the handler
 * directly instead.
 *
 * @example
 * ```ts
 * const response = await callHandler(handler, { method: 'GET', path: '/api/buoys/1' }, {
 *   env: { DB: createFakeD1Database(), KV: createFakeKVNamespace() },
 * })
 * expect(response.status).toBe(200)
 * ```
 */
export async function callHandler<TBody = unknown>(
  handler: EventHandler,
  eventOptions: FakeEventOptions = {},
  callOptions: CallHandlerOptions = {},
): Promise<FakeHandlerResponse<TBody>> {
  const event = createFakeEvent(eventOptions)

  if (callOptions.env) {
    const context = event.context as H3Event['context'] & {
      cloudflare?: { env?: Record<string, unknown> }
    }
    context.cloudflare = {
      ...context.cloudflare,
      env: { ...context.cloudflare?.env, ...callOptions.env },
    }
  }

  let result: unknown
  try {
    result = await handler(event)
  } catch (error) {
    sendError(event, error as Error)
  }

  return readFakeEventResponse<TBody>(event, result)
}
