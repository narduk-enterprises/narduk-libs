import { defineNitroPlugin } from 'nitropack/runtime'

/**
 * Global server error logger — Nitro plugin.
 *
 * Intercepts all unhandled errors and `createError` throws with status >= 500.
 * Emits structured JSON logs matching the `useLogger` format, which surface in:
 *   - `wrangler tail` (live)
 *   - Cloudflare Dashboard → Workers → Logs
 *   - Logpush (if configured)
 *
 * Intentionally skips 4xx errors — those are expected application flow.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('error', (error, ctx) => {
    const event = ctx.event
    if (!event) return

    const statusCode = (error as { statusCode?: number }).statusCode ?? 500
    if (statusCode < 500) return

    const method = event.method
    const path = event.path
    const requestId = event.context._requestId

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        requestId: requestId ?? undefined,
        method,
        path,
        message: `Server error → ${statusCode}`,
        data: {
          statusCode,
          name: error.name,
          errorMessage: error.message,
          ...(error.cause ? { cause: String(error.cause) } : {}),
          stack: error.stack,
        },
      }),
    )
  })
})
