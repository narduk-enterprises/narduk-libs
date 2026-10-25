import type { AppAuthBackend } from './auth-environment'

/**
 * Whether Google sign-in can actually complete, and with which OAuth client
 * (narduk-libs#1951).
 *
 * On the Supabase backend Google goes through Supabase, so advertising the
 * provider is enough. On the local backend this package runs the OpenID
 * Connect code flow itself, which needs the app's Google OAuth client:
 *
 * - `AUTH_GOOGLE_CLIENT_ID` — the web client id: `client_id` and the ID
 *   token's required `aud`.
 * - `AUTH_GOOGLE_CLIENT_SECRET` — the client secret, used only server-side to
 *   redeem the authorization code. Never sent to the browser.
 *
 * Like `appleEnabled`, an advertised provider without its client is not
 * enabled: a button that 501s on the first click is worse than no button.
 */
export interface GoogleSignInConfig {
  clientId: string
  clientSecret: string
  webEnabled: boolean
}

export function resolveGoogleSignInConfig(input: {
  authBackend: AppAuthBackend
  authProviders: readonly string[]
  env: Record<string, string | undefined>
}): GoogleSignInConfig {
  const advertised = input.authProviders.includes('google')
  const clientId = (input.env.AUTH_GOOGLE_CLIENT_ID ?? '').trim()
  const clientSecret = (input.env.AUTH_GOOGLE_CLIENT_SECRET ?? '').trim()

  if (input.authBackend === 'supabase') {
    return { clientId, clientSecret, webEnabled: advertised }
  }
  return {
    clientId,
    clientSecret,
    webEnabled: advertised && clientId.length > 0 && clientSecret.length > 0,
  }
}
