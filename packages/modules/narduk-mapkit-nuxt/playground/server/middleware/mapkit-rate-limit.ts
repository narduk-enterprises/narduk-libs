import { defineEventHandler, getHeader } from 'h3'

/** Fixture-only example of app-owned rate limiting for the package route. */
export default defineEventHandler((event) => {
  if (getHeader(event, 'x-mapkit-test-rate-limit') !== 'deny') return
  event.context.nardukMapKit = {
    rateLimit: () => ({
      allowed: false,
      error: 'Fixture rate limit exceeded.',
      retryAfterSeconds: 15,
    }),
  }
})
