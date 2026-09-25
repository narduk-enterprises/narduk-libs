import { useRuntimeConfig } from 'nitropack/runtime'

import { requireSharedSecret } from './shared-secret'

import type { H3Event } from 'h3'

/**
 * Require `CRON_SECRET` as the bearer token, compared in constant time
 * (narduk-libs#871). A wrapper over `requireSharedSecret` (narduk-libs#979).
 */
export function requireCronAuth(event: H3Event) {
  requireSharedSecret(event, {
    secretKey: 'CRON_SECRET',
    fallback: useRuntimeConfig(event).cronSecret,
    rejectMessage: 'Unauthorized cron request.',
  })
}
