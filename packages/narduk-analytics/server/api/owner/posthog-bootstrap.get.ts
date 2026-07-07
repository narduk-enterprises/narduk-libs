/**
 * Returns the shared PostHog distinct id for fleet owners who have tagged this
 * browser via `/api/owner-tag`. The id stays server-only until this endpoint
 * succeeds so it is not embedded in the public client bundle.
 *
 * GET /api/owner/posthog-bootstrap
 *
 * Configure `POSTHOG_OWNER_DISTINCT_ID` (same UUID in Vault across your fleet
 * if you want one PostHog person for yourself everywhere).
 */
export default defineEventHandler((event) => {
  const owner = getCookie(event, 'narduk_owner')
  if (owner !== 'true') {
    throw createError({
      statusCode: 403,
      message: 'Owner cookie required. POST /api/owner-tag with OWNER_TAG_SECRET first.',
    })
  }

  const config = useRuntimeConfig(event)
  const distinctId = config.posthogOwnerDistinctId.trim()
  if (!distinctId) {
    throw createError({
      statusCode: 501,
      message:
        'POSTHOG_OWNER_DISTINCT_ID is not set. Add it to server runtime config (Vault) to enable cross-browser owner identity.',
    })
  }

  return { distinctId }
})
