export const OG_IMAGE_SECRET_ENV = 'NUXT_OG_IMAGE_SECRET'

export const MISSING_OG_IMAGE_SECRET_MESSAGE =
  '[@narduk-enterprises/narduk-seo] Runtime OG image generation requires a non-empty NUXT_OG_IMAGE_SECRET in non-dev builds. nuxt-og-image skips signature verification when the secret is empty, which leaves /_og/ as an unauthenticated WASM renderer that will fetch attacker-chosen images. Set NUXT_OG_IMAGE_SECRET in every deployed environment (Doppler or the Worker secret store). Local `nuxt dev` stays permissive. Apps that only ship a static defaultOgImage can set ogImage.enabled: false or ogImage.zeroRuntime: true instead.'

export function resolveOgImageSigningSecret(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isOgImageSigningSecretConfigured(value: unknown): boolean {
  return resolveOgImageSigningSecret(value).length > 0
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
}
