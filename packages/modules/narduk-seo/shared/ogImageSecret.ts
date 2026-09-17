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
  '[@narduk-enterprises/narduk-seo] NUXT_OG_IMAGE_SECRET equals the committed test-only placeholder, and this build is one the estate deploys. That value is public and must never sign a live Worker. Set a real secret as a Workers Builds Build variable. The placeholder stays valid for builds nothing deploys: `nuxt dev`, GitHub Actions `build:ci`, and the packed-consumer smoke fixture.'

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
 * The committed placeholder only matters where a build-time secret ends up
 * signing a live Worker. In this estate a built artefact reaches production
 * through exactly two sanctioned routes, both of which `narduk-app-tools`
 * already gates on (`deploy.ts` `isWorkersBuildDeployAllowed` /
 * `isLocalDeployAllowed`):
 *
 * - Workers Builds, which injects `WORKERS_CI` / `WORKERS_CI_BRANCH`; and
 * - an explicit local `wrangler deploy` behind
 *   `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY`.
 *
 * Everything else -- `nuxt dev`, GitHub Actions `build:ci`, and narduk-libs'
 * own packed-consumer smoke, which builds a generated fixture app in a temp
 * directory and throws it away -- produces nothing that is deployed.
 *
 * This deliberately keys on the deploy signal rather than enumerating the
 * allowed build contexts. The first version of this rule allow-listed
 * `NARDUK_CLOUDFLARE_BUILD=1` (`build:ci`) and broke the packed-consumer smoke
 * the moment narduk-libs#440 started filling the same placeholder for the
 * fixture build: an allow-list of sanctioned non-deploy builds is a list that
 * is always one context out of date.
 *
 * `NARDUK_DEPLOY_TARGET` cannot serve here. Generated `nuxt.config.ts` sets it
 * to `production` itself whenever `WORKERS_CI_BRANCH` is unset, so `build:ci`
 * and the smoke fixture both report `production`.
 */
export function isDeployedBuild(): boolean {
  const workersBuild =
    envFlagOn(process.env.WORKERS_CI) || Boolean(process.env.WORKERS_CI_BRANCH?.trim())
  return workersBuild || envFlagOn(process.env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY)
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
  if (isCiTestOnlyOgImageSecret(input.secret) && isDeployedBuild()) {
    throw new Error(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  }
}
