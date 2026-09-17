export const OG_IMAGE_SECRET_ENV = 'NUXT_OG_IMAGE_SECRET'

/**
 * Throwaway value generated apps already emit for Playwright `dev:test`.
 * After the packaging PR, `build:ci` prefixes the same literal. One
 * definition lives here; a test fails if the generator files drift.
 */
export const CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET = 'narduk-test-only-og-image-secret-000000'

export const MISSING_OG_IMAGE_SECRET_MESSAGE =
  '[@narduk-enterprises/narduk-seo] Runtime OG image generation requires a non-empty NUXT_OG_IMAGE_SECRET in non-dev builds. With no secret, nuxt-og-image auto-generates a new one on every build, so every previously signed /_og/ URL stops verifying: a rolling Worker release serves two secrets at once and cached signed URLs 403 until they are regenerated. The estate needs one stable operator-provided secret. Set NUXT_OG_IMAGE_SECRET in every deployed environment (a Workers Builds Build variable, not a runtime Worker secret -- signing is resolved at build time). Local `nuxt dev` stays permissive. Apps that only ship a static defaultOgImage can set ogImage.enabled: false or ogImage.zeroRuntime: true instead. Never set ogImage.security.secret: false; that is the setting that actually disables signing and leaves /_og/ an unauthenticated renderer.'

export const CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE =
  '[@narduk-enterprises/narduk-seo] NUXT_OG_IMAGE_SECRET equals the committed test-only placeholder. That value is for GitHub Actions `build:ci` only and must never sign a production or Workers Builds (`cf:build`) deployment. Set a real secret as a Workers Builds Build variable.'

export function resolveOgImageSigningSecret(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isOgImageSigningSecretConfigured(value: unknown): boolean {
  return resolveOgImageSigningSecret(value).length > 0
}

export function isCiTestOnlyOgImageSecret(value: unknown): boolean {
  return resolveOgImageSigningSecret(value) === CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET
}

function envFlagOn(value: string | undefined): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return false
  return !['0', 'false', 'no', 'off'].includes(trimmed.toLowerCase())
}

/**
 * The placeholder is allowed only on GitHub Actions `build:ci`.
 *
 * Verified in this repo (not assumed from the review's names):
 * - `build:ci` is the only generated script that sets
 *   `NARDUK_CLOUDFLARE_BUILD=1`.
 * - `cf:build` is `og:generate && og:check && nuxt build --preset=cloudflare_module`
 *   with no placeholder prefix; Workers Builds injects `WORKERS_CI` /
 *   `WORKERS_CI_BRANCH`.
 * - Generated `nuxt.config.ts` does `NARDUK_DEPLOY_TARGET ??= production`
 *   when `WORKERS_CI_BRANCH` is unset, so `build:ci` also sees production.
 *   Rejecting on that env var alone would break CI.
 */
export function allowsCiTestOnlyOgImageSecret(): boolean {
  const cloudflareCiBuild = process.env.NARDUK_CLOUDFLARE_BUILD?.trim() === '1'
  const workersBuild =
    envFlagOn(process.env.WORKERS_CI) || Boolean(process.env.WORKERS_CI_BRANCH?.trim())
  return cloudflareCiBuild && !workersBuild
}

/**
 * Fail closed before nuxt-og-image is installed for a real non-dev build.
 * `nuxt dev` and `nuxt prepare` stay permissive so local work and typecheck
 * do not require a production secret.
 */
export function assertOgImageSigningSecretForBuild(input: {
  isDev: boolean
  isPrepare?: boolean
  runtimeGenerationEnabled: boolean
  secret: unknown
}): void {
  if (input.isDev || input.isPrepare || !input.runtimeGenerationEnabled) return
  if (!isOgImageSigningSecretConfigured(input.secret)) {
    throw new Error(MISSING_OG_IMAGE_SECRET_MESSAGE)
  }
  if (isCiTestOnlyOgImageSecret(input.secret) && !allowsCiTestOnlyOgImageSecret()) {
    throw new Error(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  }
}
