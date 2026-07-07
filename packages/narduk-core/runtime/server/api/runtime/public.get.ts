import { defineEventHandler, setResponseHeader } from 'h3'

import { resolveRuntimePublicOverlay } from '../../utils/runtime-public'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return resolveRuntimePublicOverlay(event)
})
