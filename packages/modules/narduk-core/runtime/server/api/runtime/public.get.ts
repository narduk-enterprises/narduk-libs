import { defineEventHandler, setResponseHeader } from 'h3'

import { applyRuntimePublicOverlay } from '../../utils/runtime-public'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return applyRuntimePublicOverlay(event)
})
