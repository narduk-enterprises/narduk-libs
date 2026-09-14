/**
 * Owner Tag Endpoint
 *
 * Sets or clears the `narduk_owner` cookie used by the PostHog plugin
 * to tag internal/owner traffic. Protected by a shared secret so only
 * the site owner can call it.
 *
 * Cross-browser PostHog identity (optional): set the same
 * `POSTHOG_OWNER_DISTINCT_ID` (server-only UUID) in Vault for each app; after
 * owner-tag, the client loads `/api/owner/posthog-bootstrap` and calls
 * `posthog.identify` so all your devices merge into one person.
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

const ownerTagSchema = z.object({
  secret: z.string(),
  enabled: z.boolean().optional().default(true),
})

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.ownerTag,
    parseBody: withValidatedBody(ownerTagSchema.parse),
  },
  ({ event, body }) => {
    const input = requireMutationBody(body)
    const config = useRuntimeConfig(event)
    const ownerSecret = config.ownerTagSecret

    if (!ownerSecret) {
      throw createError({
        statusCode: 501,
        message: 'Owner tagging is not configured. Set OWNER_TAG_SECRET in Vault.',
      })
    }

    if (input.secret !== ownerSecret) {
      throw createError({
        statusCode: 403,
        message: 'Invalid secret.',
      })
    }

    const enabled = input.enabled
    const cookieName = 'narduk_owner'

    if (enabled) {
      setCookie(event, cookieName, 'true', {
        httpOnly: false, // Must be readable by the PostHog client plugin
        secure: !import.meta.dev,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 1 year
      })
    } else {
      deleteCookie(event, cookieName, {
        path: '/',
      })
    }

    return { ok: true, tagged: enabled }
  },
)
