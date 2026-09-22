/**
 * Returns the shared PostHog distinct id for fleet owners who have tagged this
 * browser via `/api/owner-tag`. The id stays server-only until this endpoint
 * succeeds so it is not embedded in the public client bundle.
 *
 * The unsigned `narduk_owner=true` flag is not enough: bootstrap also requires
 * the httpOnly HMAC proof cookie minted with `OWNER_TAG_SECRET`. The flag stays
 * client-readable so `posthog.client` can set `is_owner` without holding the
 * secret. The browser sends both cookies automatically.
 *
 * GET /api/owner/posthog-bootstrap
 *
 * Configure `POSTHOG_OWNER_DISTINCT_ID` (same UUID in Vault across your fleet
 * if you want one PostHog person for yourself everywhere).
 */
import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { loadOwnerPosthogBootstrap } from '#narduk-analytics-server/utils/owner-tag-proof'

export default defineEventHandler(async (event) => {
  await enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.ownerTag)

  const config = useRuntimeConfig(event)
  return loadOwnerPosthogBootstrap(event, {
    ownerTagSecret: config.ownerTagSecret,
    posthogOwnerDistinctId: config.posthogOwnerDistinctId,
  })
})
