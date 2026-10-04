import { hostAwareNoindexRule } from './hostAwareIndexing'

/**
 * Robots directive for an error response: `noindex, nofollow` for any 4xx or
 * 5xx status, else `undefined` so the route's own rule stands. An error page
 * must never advertise `index` (narduk-libs#1415).
 */
export function errorRobotsRule(statusCode: unknown): string | undefined {
  const status = Number(statusCode)
  return Number.isInteger(status) && status >= 400 ? hostAwareNoindexRule : undefined
}
