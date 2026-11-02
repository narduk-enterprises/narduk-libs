/**
 * Resolves the OG image signing secret per request from the Worker's runtime
 * secret, and refuses `/_og/` when there is none. Registered by `src/module.ts`
 * as Nitro middleware (it runs before nuxt-og-image's `/_og/**` handlers and
 * the SSR renderer) whenever runtime OG generation is on, which is why it lives
 * in `handlers/` rather than `middleware/`.
 *
 * A build without `NUXT_OG_IMAGE_SECRET` bakes an empty secret (the module
 * blanks the one nuxt-og-image generates per build), so a Worker that also has
 * no runtime secret would otherwise skip signature checks entirely
 * (`dist/runtime/server/og-image/context.js` verifies only when a secret is
 * set). `nuxt dev` and prerender stay permissive.
 */
import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import { readWorkerRuntimeEnvValue } from '@narduk-enterprises/narduk-core/server/utils/worker-env'

import {
  applyRuntimeOgImageSigningSecret,
  isOgImageRequestPath,
  MISSING_OG_IMAGE_SECRET_MESSAGE,
  OG_IMAGE_SECRET_ENV,
} from '../../shared/ogImageSecret'

// Pages still render without a secret, so say why their OG images 503 once
// per isolate rather than on every request.
let hasLoggedMissingSecret = false

export default defineEventHandler((event) => {
  if (import.meta.dev || import.meta.prerender) return
  const runtimeConfig = useRuntimeConfig(event)
  const secret = applyRuntimeOgImageSigningSecret({
    runtimeConfig,
    workerSecret: readWorkerRuntimeEnvValue(event, OG_IMAGE_SECRET_ENV),
  })
  if (secret) return
  if (!hasLoggedMissingSecret) {
    hasLoggedMissingSecret = true
    useLogger(event).child('OgImage').error(MISSING_OG_IMAGE_SECRET_MESSAGE)
  }
  if (isOgImageRequestPath(event.path, runtimeConfig.app.baseURL)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OG image signing secret is not configured.',
    })
  }
})
