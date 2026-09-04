/**
 * Request logger middleware — automatic structured logging for all routes.
 *
 * Logs every request + response at `info` level with method, path, status, and duration.
 * Skipped for internal/noisy paths: /_nuxt/, /__nuxt_error, /api/health.
 *
 * Controlled by `runtimeConfig.logLevel`. Set LOG_LEVEL=silent to disable entirely.
 */
import { defineEventHandler } from 'h3'

import { ensureRequestId, useLogger } from '../utils/logger'

export default defineEventHandler((event) => {
  const path = event.path

  // Skip internal/high-frequency paths
  if (
    path.startsWith('/_nuxt/') ||
    path.startsWith('/__nuxt') ||
    path === '/api/health' ||
    path.startsWith('/favicon')
  ) {
    return
  }

  // Generate request ID early so all downstream logs share it
  ensureRequestId(event)

  const start = Date.now()

  // Use onAfterResponse to log after the handler completes
  event.node.res.on('finish', () => {
    const log = useLogger(event)
    const duration = Date.now() - start
    const status = event.node.res.statusCode

    log.info(`${event.method} ${path} → ${status} (${duration}ms)`, {
      status,
      duration,
    })
  })
})
