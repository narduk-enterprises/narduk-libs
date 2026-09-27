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
  '[@narduk-enterprises/narduk-seo] NUXT_OG_IMAGE_SECRET equals the committed test-only placeholder. That value is public and must never sign a Worker a person can deploy. It is accepted only for `nuxt dev`, `nuxt prepare`, and an explicit `build:ci`: the generated script sets NARDUK_CLOUDFLARE_BUILD=1 and is not a Workers Builds or local wrangler deploy (WORKERS_CI, WORKERS_CI_BRANCH, or NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY). A `build` or `cf:build` that defaults this placeholder is refused. Set a real secret as a Workers Builds Build variable.'

/** Env var the generated `build:ci` script exports before `nuxt build`. */
export const BUILD_CI_ENV = 'NARDUK_CLOUDFLARE_BUILD'

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
 * Is this build one the estate actually deploys?
 *
 * A built artefact reaches a live Worker through Workers Builds
 * (`WORKERS_CI` / `WORKERS_CI_BRANCH`) or an explicit local `wrangler deploy`
 * (`NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY`). `NARDUK_DEPLOY_TARGET` cannot serve
 * here: generated `nuxt.config.ts` sets it to `production` whenever
 * `WORKERS_CI_BRANCH` is unset, so `build:ci` and a plain `nuxt build` both
 * report `production`.
 */
export function isDeployedBuild(): boolean {
  const workersBuild =
    envFlagOn(process.env.WORKERS_CI) || Boolean(process.env.WORKERS_CI_BRANCH?.trim())
  return workersBuild || envFlagOn(process.env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY)
}

/**
 * Generated `build:ci` exports `NARDUK_CLOUDFLARE_BUILD=1` before `pnpm run build`.
 * A hand-written `build` or `cf:build` that only defaults the placeholder does
 * not (narduk-libs#1155). `hotfix:build` also exports this variable; that
 * script does not export the placeholder, and a real secret is still accepted.
 *
 * Packed-consumer runs the generated `build:ci` (narduk-libs#617), so requiring
 * the variable does not reject that smoke. Deploy signals still reject the
 * placeholder even when the variable is set.
 */
export function isExplicitBuildCi(): boolean {
  return process.env[BUILD_CI_ENV]?.trim() === '1'
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
  if (isCiTestOnlyOgImageSecret(input.secret) && !(isExplicitBuildCi() && !isDeployedBuild())) {
    throw new Error(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  }
}
