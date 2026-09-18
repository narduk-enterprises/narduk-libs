/**
 * Committed, test-only Nuxt values. CI and Playwright need a non-empty
 * `NUXT_OG_IMAGE_SECRET` for a real `nuxt build` when runtime OG is on
 * (narduk-seo fails closed). These are not production secrets and must
 * never be referenced as `${{ secrets.* }}` — a fresh repo has none.
 */
export const CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET = 'narduk-test-only-og-image-secret-000000'
export const CI_TEST_ONLY_NUXT_SESSION_PASSWORD = 'narduk-test-only-session-password-000000'

export function ciTestOnlyNuxtEnvPrefix(): string {
  return (
    `NUXT_OG_IMAGE_SECRET=${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET} ` +
    `NUXT_SESSION_PASSWORD=${CI_TEST_ONLY_NUXT_SESSION_PASSWORD}`
  )
}
