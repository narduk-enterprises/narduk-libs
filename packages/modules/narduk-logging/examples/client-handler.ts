import { defineClientLogHandler, useLogger } from '@narduk-enterprises/narduk-logging/h3'
import type { H3Event } from 'h3'

/** Export the returned handler from your app's server/api/_narduk/logs.post.ts. */
export function createDiagnosticsRoute(policy: {
  authorize(event: H3Event): Promise<boolean>
  rateLimit(event: H3Event): Promise<boolean>
}) {
  return defineClientLogHandler({
    logger: (event) => useLogger(event),
    authorize: policy.authorize,
    rateLimit: policy.rateLimit,
    allowedDataFields: ['check', 'count'],
  })
}
