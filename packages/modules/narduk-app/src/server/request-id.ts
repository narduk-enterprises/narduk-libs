import { setResponseHeader } from 'h3'

import type { H3Event } from 'h3'

const ID_SHAPE = /^[\w.:-]{1,128}$/

type HeaderValue = string | string[] | undefined

/** `cf-ray` when Cloudflare sent one, else a well-formed caller `x-request-id`, else a fresh random id. */
export function resolveRequestId(
  header: (name: string) => HeaderValue,
  random: () => string = () => crypto.randomUUID(),
): string {
  for (const name of ['cf-ray', 'x-request-id']) {
    const value = header(name)
    const text = Array.isArray(value) ? value[0] : value
    if (text && ID_SHAPE.test(text)) return text
  }
  return random()
}

/** An error body with `requestId` added; anything that is not a JSON object (a redirect notice) passes through. */
export function stampRequestId<T>(body: T, requestId: string): T | (T & { requestId: string }) {
  return body && typeof body === 'object' && !Array.isArray(body) ? { ...body, requestId } : body
}

/** Names the request: `event.context.requestId` and the `x-request-id` response header. */
export function applyRequestId(event: H3Event): string {
  const requestId = resolveRequestId((name) => event.node.req.headers[name])
  event.context.requestId = requestId
  setResponseHeader(event, 'x-request-id', requestId)
  return requestId
}

/** Registers {@link applyRequestId} on a Nitro `request` hook; call it from a Nitro plugin. */
export function installRequestId(nitroApp: {
  hooks: { hook(name: 'request', handler: (event: H3Event) => void): unknown }
}): void {
  nitroApp.hooks.hook('request', (event) => {
    applyRequestId(event)
  })
}
