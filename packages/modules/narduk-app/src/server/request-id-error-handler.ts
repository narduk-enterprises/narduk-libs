import { send, setResponseHeaders, setResponseStatus } from 'h3'

import { stampRequestId } from './request-id'

import type { H3Error, H3Event } from 'h3'

type HandlerResponse = {
  status: number
  statusText: string
  headers: Record<string, string>
  body: unknown
}

type DefaultHandler = (
  error: H3Error,
  event: H3Event,
  opts?: { json?: boolean },
) => Promise<HandlerResponse> | HandlerResponse

/**
 * A Nitro `errorHandler` that runs ahead of Nuxt's: an `/api/` error body carries `requestId`;
 * pages and dev fall through. Register it first in `nitro.errorHandler`.
 */
export default async function requestIdErrorHandler(
  error: H3Error,
  event: H3Event,
  { defaultHandler }: { defaultHandler: DefaultHandler },
) {
  if (
    event.handled ||
    (import.meta as { dev?: boolean }).dev ||
    !(event.path ?? '').startsWith('/api/')
  )
    return
  const requestId = event.context.requestId as string | undefined
  if (!requestId) return
  const { headers, status, statusText, body } = await defaultHandler(error, event, { json: true })
  setResponseHeaders(event, headers)
  setResponseStatus(event, status, statusText)
  return send(
    event,
    typeof body === 'string' ? body : JSON.stringify(stampRequestId(body, requestId), null, 2),
  )
}
