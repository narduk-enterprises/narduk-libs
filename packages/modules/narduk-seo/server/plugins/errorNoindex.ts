import { getResponseStatus, type H3Event, setResponseHeader } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'

import { errorRobotsRule } from '../../shared/errorRobots'

function applyErrorRobotsRule(event: H3Event | undefined, statusCode: unknown): void {
  const rule = errorRobotsRule(statusCode)
  if (event && rule) setResponseHeader(event, 'X-Robots-Tag', rule)
}

/**
 * Error responses never advertise `index` (narduk-libs#1415).
 *
 * @nuxtjs/robots sets `X-Robots-Tag` in request middleware, before the status
 * is known, so a 404 kept the route's `index, follow` header. A thrown error
 * (a missing page, an API 404) reaches Nitro's `error` hook and a page that
 * sets a 4xx status without throwing reaches `render:response`; both replace
 * the header with `noindex, nofollow`.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    const statusCode = (error as { statusCode?: unknown }).statusCode ?? 500
    applyErrorRobotsRule(event, event ? getResponseStatus(event) || statusCode : statusCode)
  })
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    applyErrorRobotsRule(event, response.statusCode)
  })
})
