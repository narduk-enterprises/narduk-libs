import { parseURL, withoutBase } from 'ufo'

export const OG_IMAGE_SECRET_ENV = 'NUXT_OG_IMAGE_SECRET'

/**
 * Throwaway value generated apps already emit for Playwright `dev:test`.
 * After the packaging PR, `build:ci` prefixes the same literal. One
 * definition lives here; a test fails if the generator files drift.
 */
export const CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET = 'narduk-test-only-og-image-secret-000000'

export const MISSING_OG_IMAGE_SECRET_MESSAGE =
  '[@narduk-enterprises/narduk-seo] Runtime OG image generation is enabled but this Worker has no NUXT_OG_IMAGE_SECRET, so /_og/ refuses to render (503) and pages emit unsigned OG URLs. Set NUXT_OG_IMAGE_SECRET as a runtime Worker secret (`wrangler secret put NUXT_OG_IMAGE_SECRET`); the build does not need it. nuxt-og-image would otherwise sign with a secret it auto-generates on every build, so a rolling release serves two secrets at once and cached signed URLs 403, and narduk-seo blanks that generated secret instead of shipping it. Local `nuxt dev` stays permissive. Apps that only ship a static defaultOgImage can set ogImage.enabled: false or ogImage.zeroRuntime: true instead. Never set ogImage.security.secret: false; that disables signing and leaves /_og/ an unauthenticated renderer.'

export const CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE =
  '[@narduk-enterprises/narduk-seo] NUXT_OG_IMAGE_SECRET equals the committed test-only placeholder. That value is public and must never sign a Worker a person can deploy. A build accepts it only when NARDUK_CLOUDFLARE_BUILD=1 is set and none of WORKERS_CI, WORKERS_CI_BRANCH, or NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY is. That build writes .narduk-build-ci into its Nitro output, and `narduk-app deploy` refuses to publish an output holding that file. This build is a Workers Builds or local wrangler deploy build, or does not set NARDUK_CLOUDFLARE_BUILD=1, so it is refused. `nuxt dev` and `nuxt prepare` stay permissive. Leave NUXT_OG_IMAGE_SECRET unset at build and set it as a runtime Worker secret.'

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
 * So do most hand-written `cf:build` scripts and `ship:build`, so this
 * variable alone cannot tell a CI build from one a person will deploy
 * (narduk-libs#1155). A build that accepts the placeholder on this signal
 * therefore marks its own Nitro output (see `src/buildCiOutputMarker.ts`),
 * and `narduk-app deploy` refuses that output whichever script built it.
 *
 * Packed-consumer runs the generated `build:ci` (narduk-libs#617), so requiring
 * the variable does not reject that smoke. Deploy signals still reject the
 * placeholder even when the variable is set.
 */
export function isExplicitBuildCi(): boolean {
  return process.env[BUILD_CI_ENV]?.trim() === '1'
}

/**
 * Refuse a non-dev build that would sign with the public CI placeholder
 * outside `build:ci`. A build with no secret is accepted: the deployed Worker
 * resolves its secret at request time (`resolveRuntimeOgImageSigningSecret`)
 * and refuses to render without one (`server/handlers/ogImageRuntimeSecret.ts`),
 * so CI can build the production output without the production secret.
 * `nuxt dev` and `nuxt prepare` stay permissive.
 *
 * Returns true when a non-dev build accepted the test-only placeholder. The
 * caller must then mark the build output so it cannot be deployed.
 */
export function assertOgImageSigningSecretForBuild(input: {
  isDev: boolean
  isPrepare?: boolean
  runtimeGenerationEnabled: boolean
  secret: unknown
}): boolean {
  if (input.isDev || input.isPrepare || !input.runtimeGenerationEnabled) return false
  if (!isOgImageSigningSecretConfigured(input.secret)) return false
  if (!isCiTestOnlyOgImageSecret(input.secret)) return false
  if (!isExplicitBuildCi() || isDeployedBuild()) {
    throw new Error(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  }
  return true
}

/**
 * Does this non-dev build leave the signing secret to the deployed Worker?
 *
 * True when runtime OG generation is on and no explicit secret was given.
 * nuxt-og-image 6.8.0 then generates a random secret for this one build and
 * bakes it into `runtimeConfig['nuxt-og-image'].security.secret`
 * (`resolveSigningSecret` in its module chunk). The caller blanks that value
 * so a Worker without its runtime secret cannot sign or verify with it.
 */
export function shouldBlankGeneratedOgImageSecret(input: {
  isDev: boolean
  isPrepare?: boolean
  runtimeGenerationEnabled: boolean
  secret: unknown
}): boolean {
  if (input.isDev || input.isPrepare || !input.runtimeGenerationEnabled) return false
  return !isOgImageSigningSecretConfigured(input.secret)
}

interface OgImageSecretRuntimeConfig {
  'nuxt-og-image'?: { security?: { secret?: unknown } & Record<string, unknown> }
  ogImage?: { secret?: unknown } & Record<string, unknown>
}

/**
 * The signing secret a request resolves: the Worker's `NUXT_OG_IMAGE_SECRET`
 * binding (narduk-core's reader, which falls back to `process.env` off
 * Workers), then `runtimeConfig.ogImage.secret` (Nitro's env overlay, or a
 * secret baked at build), then the module's baked secret. The runtime binding
 * comes first so it wins over a secret baked by an older build. Empty means
 * the Worker has no secret and must refuse.
 */
export function resolveRuntimeOgImageSigningSecret(input: {
  runtimeConfig: OgImageSecretRuntimeConfig
  workerSecret: unknown
}): string {
  return (
    resolveOgImageSigningSecret(input.workerSecret) ||
    resolveOgImageSigningSecret(input.runtimeConfig.ogImage?.secret) ||
    resolveOgImageSigningSecret(input.runtimeConfig['nuxt-og-image']?.security?.secret)
  )
}

/**
 * Write the resolved secret, or `''` when there is none, into this request's
 * runtime config.
 *
 * nuxt-og-image's server helper prefers `runtimeConfig.ogImage.secret` over
 * the Worker binding, and its app helper, which signs `og:image` URLs during
 * SSR (`dist/runtime/app/utils.js`), reads only that key. Writing both keys
 * makes SSR signing, `/_og/` verification and the preview resolver use one
 * value; an untrimmed whitespace-only build secret is overwritten with `''`,
 * so SSR emits unsigned URLs rather than signing with it. `runtimeConfig` must
 * be the per-request copy (`useRuntimeConfig(event)`), never the shared one.
 */
export function applyRuntimeOgImageSigningSecret(input: {
  runtimeConfig: OgImageSecretRuntimeConfig
  workerSecret: unknown
}): string {
  const secret = resolveRuntimeOgImageSigningSecret(input)
  const { runtimeConfig } = input
  runtimeConfig.ogImage = { ...runtimeConfig.ogImage, secret }
  const moduleConfig = (runtimeConfig['nuxt-og-image'] ??= {})
  moduleConfig.security = { ...moduleConfig.security, secret }
  return secret
}

/** Every route nuxt-og-image 6.8.0 registers sits under `/_og/`. */
export function isOgImageRequestPath(path: string, baseURL = '/'): boolean {
  return withoutBase(parseURL(path).pathname, baseURL).startsWith('/_og/')
}
