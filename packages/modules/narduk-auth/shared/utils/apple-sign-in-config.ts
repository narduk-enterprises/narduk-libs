import type { AppAuthBackend } from './auth-environment'

/**
 * Whether Sign in with Apple can actually complete, and with which client ids
 * (narduk-libs#164).
 *
 * On the Supabase backend Apple goes through Supabase, so advertising the
 * provider is enough. On the local backend this package verifies Apple's
 * identity token itself, which needs the app's Apple client ids:
 *
 * - `AUTH_APPLE_SERVICES_ID` — the Services ID the web flow uses as `client_id`
 *   (and the identity token's `aud`).
 * - `AUTH_APPLE_NATIVE_CLIENT_IDS` — comma-separated bundle ids whose native
 *   identity tokens `signInWithNativeApple` accepts.
 *
 * Like `passkeysEnabled`, an advertised provider without its binding is not
 * enabled: a button that 501s on the first click is worse than no button.
 */
export interface AppleSignInConfig {
  nativeClientIds: string[]
  nativeEnabled: boolean
  servicesId: string
  webEnabled: boolean
}

export function resolveAppleSignInConfig(input: {
  authBackend: AppAuthBackend
  authProviders: readonly string[]
  env: Record<string, string | undefined>
}): AppleSignInConfig {
  const advertised = input.authProviders.includes('apple')
  const servicesId = (input.env.AUTH_APPLE_SERVICES_ID ?? '').trim()
  const nativeClientIds = (input.env.AUTH_APPLE_NATIVE_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id, index, ids) => id && ids.indexOf(id) === index)

  if (input.authBackend === 'supabase') {
    return { nativeClientIds, nativeEnabled: advertised, servicesId, webEnabled: advertised }
  }
  return {
    nativeClientIds,
    nativeEnabled: advertised && nativeClientIds.length > 0,
    servicesId,
    webEnabled: advertised && servicesId.length > 0,
  }
}
