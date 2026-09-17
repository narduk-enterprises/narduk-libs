import { defineEventHandler } from 'h3'

import { ensureRequestId } from '../utils/logger'

/** Keep early correlation; completion belongs to the shared Nitro lifecycle plugin. */
export default defineEventHandler((event) => {
  const id = ensureRequestId(event)

  // Nuxt can render a failed page by re-entering this same Nitro app with the
  // original request's headers. Echoing the id back onto the incoming headers
  // makes that second event adopt it instead of minting a new one, so the id
  // printed on the error page, the `x-request-id` response header, and the log
  // record for the failure are one value.
  const headers = event.node?.req?.headers
  if (headers && headers['x-request-id'] !== id) {
    try {
      headers['x-request-id'] = id
    } catch {
      // Some runtimes expose an immutable header bag; correlation still works
      // for every consumer that reads event.context._requestId.
    }
  }
})
