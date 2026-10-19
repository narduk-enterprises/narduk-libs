import { type Ref, ref } from 'vue'
import { z } from 'zod'

import { toUserFacingError } from '../utils/toUserFacingError'

/**
 * Sign-in actions the login and register cards share: the redirect-based
 * providers (Apple, Google — narduk-libs#164, #1951) and the passwordless
 * email link (#1952). Not auto-imported; the cards import it.
 */

export type CardOAuthProvider = 'apple' | 'google'

const OAUTH_START_ERRORS: Record<CardOAuthProvider, string> = {
  apple: 'Unable to start Sign in with Apple.',
  google: 'Unable to start Google sign-in.',
}

/**
 * Which redirect providers a card offers: the server's runtime answer covers
 * the local backend; without one, keep the build-time Supabase-only rule.
 */
export function cardOAuthOffers(
  runtime:
    | {
        appleEnabled?: boolean
        authBackend?: string
        authProviders?: readonly string[]
        googleEnabled?: boolean
      }
    | null
    | undefined,
  fallback: { authBackend: string; authProviders: readonly string[] },
): Record<CardOAuthProvider, boolean> {
  const supabase = (runtime?.authBackend ?? fallback.authBackend) === 'supabase'
  const providers = runtime?.authProviders ?? fallback.authProviders
  const offers = (answer: boolean | undefined, provider: CardOAuthProvider) =>
    answer ?? (supabase && providers.includes(provider))
  return {
    apple: offers(runtime?.appleEnabled, 'apple'),
    google: offers(runtime?.googleEnabled, 'google'),
  }
}

/** "Continue with Apple/Google": start the flow, then leave for the provider. */
export function useCardOAuthStart(deps: {
  errorMsg: Ref<string>
  navigate: (url: string) => unknown
  next: Ref<string>
  startOAuth: (payload: { next?: string; provider: CardOAuthProvider }) => Promise<{ url: string }>
}) {
  const loading = ref<CardOAuthProvider | null>(null)

  async function start(provider: CardOAuthProvider) {
    loading.value = provider
    deps.errorMsg.value = ''
    try {
      const result = await deps.startOAuth({ provider, next: deps.next.value })
      await deps.navigate(result.url)
    } catch (error) {
      deps.errorMsg.value = toUserFacingError(error, OAUTH_START_ERRORS[provider])
    } finally {
      loading.value = null
    }
  }

  return { loading, start }
}

/** "Email me a sign-in link": the server answers the same for every address. */
export function useCardEmailLink(deps: {
  email: () => string
  errorMsg: Ref<string>
  infoMsg: Ref<string>
  next: Ref<string>
  requestEmailLink: (payload: { email: string; next?: string }) => Promise<{ message?: string }>
}) {
  const loading = ref(false)

  async function send() {
    deps.errorMsg.value = ''
    const email = deps.email()
    if (!z.string().email().safeParse(email).success) {
      deps.errorMsg.value = 'Enter your email address to get a sign-in link.'
      return
    }
    loading.value = true
    try {
      const result = await deps.requestEmailLink({ email, next: deps.next.value })
      deps.infoMsg.value = result.message ?? 'Check your email for a sign-in link.'
    } catch (error) {
      deps.errorMsg.value = toUserFacingError(error, 'Unable to send a sign-in link.')
    } finally {
      loading.value = false
    }
  }

  return { loading, send }
}
