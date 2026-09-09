import { defineEventHandler } from 'h3'

import { ensureRequestId } from '../utils/logger'

/** Keep early correlation; completion belongs to the shared Nitro lifecycle plugin. */
export default defineEventHandler((event) => {
  ensureRequestId(event)
})
