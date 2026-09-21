/**
 * Owner Tag Endpoint
 *
 * Sets or clears two cookies after `OWNER_TAG_SECRET` succeeds:
 * - `narduk_owner=true` — unsigned, `httpOnly: false`, so the PostHog client
 *   plugin can read it from `document.cookie` and set `is_owner`.
 * - `__Host-narduk_owner_proof` (HTTPS) or `narduk_owner_proof` (HTTP dev) —
 *   `httpOnly`, HMAC-SHA-256 of `narduk-owner-proof:v2:<iat>` keyed by
 *   `OWNER_TAG_SECRET`. `/api/owner/posthog-bootstrap` requires this proof
 *   (and a server-side max age) before releasing `POSTHOG_OWNER_DISTINCT_ID`.
 *   Clearing the tag deletes both cookies. Old v1 64-hex proofs are rejected.
 *
 * Cross-browser PostHog identity (optional): set the same
 * `POSTHOG_OWNER_DISTINCT_ID` (server-only UUID) in Vault for each app; after
 * owner-tag, the client loads `/api/owner/posthog-bootstrap` and calls
 * `posthog.identify` so all your devices merge into one person. The browser
 * sends the proof cookie automatically; the client never holds the secret.
 *
 * Usage (once per browser/device):
 *   curl -X POST https://myapp.com/api/owner-tag \
 *     -H "Content-Type: application/json" \
 *     -d '{"secret":"<OWNER_TAG_SECRET>","enabled":true}'
 *
 * To remove the tag:
 *   curl -X POST https://myapp.com/api/owner-tag \
 *     -H "Content-Type: application/json" \
 *     -d '{"secret":"<OWNER_TAG_SECRET>","enabled":false}'
 */
import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  applyOwnerTagCookies,
  timingSafeEqual,
} from '#narduk-analytics-server/utils/owner-tag-proof'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

const ownerTagSchema = z.object({
  secret: z.string(),
  enabled: z.boolean().optional().default(true),
})

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.ownerTag,
    parseBody: withValidatedBody(ownerTagSchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    const config = analyticsRuntimeConfig(event)
    const ownerSecret = config.ownerTagSecret

    if (!ownerSecret) {
      throw createError({
        statusCode: 501,
        message: 'Owner tagging is not configured. Set OWNER_TAG_SECRET in Vault.',
      })
    }

    if (!timingSafeEqual(input.secret, ownerSecret)) {
      throw createError({
        statusCode: 403,
        message: 'Invalid secret.',
      })
    }

    const enabled = input.enabled
    await applyOwnerTagCookies(event, {
      enabled,
      secret: ownerSecret,
      secure: !import.meta.dev,
    })

    return { ok: true, tagged: enabled }
  },
)
