/**
 * `useUserSession` for an app that sets `nardukCore.auth: false`
 * (narduk-libs#169).
 *
 * With auth off, narduk-core does not install `nuxt-auth-utils`, so nothing
 * registers `useUserSession`. Core's dashboard layout still renders
 * `LayerDashboardShell` and `LayerDashboardAccountMenu`, which call it, and the
 * runtime-import bridge injects `import { useUserSession } from '#imports'`
 * into them. The module registers this stub under that name instead, so those
 * components render as signed out and no request reaches `/api/_auth/session`.
 *
 * It keeps the return shape of `nuxt-auth-utils`' `UserSessionComposable`
 * (0.5.x). This file lives outside `runtime/app/composables` on purpose: that
 * directory is an auto-import dir for every app, and this name must only be
 * registered when the real composable is absent.
 */
import { computed, ref } from 'vue'

import type { ComputedRef, Ref } from 'vue'

export type SignedOutUser = Record<string, unknown>

export interface SignedOutUserSession {
  [key: string]: unknown
  id: string
  user?: SignedOutUser
}

export interface SignedOutUserSessionComposable {
  /** No-op: there is no session cookie to clear. */
  clear: () => Promise<void>
  /** No-op: there is no session route to fetch from. */
  fetch: () => Promise<void>
  /** Always false. */
  loggedIn: ComputedRef<boolean>
  /** No-op: there is no OAuth route to open. */
  openInPopup: (route: string, size?: { height?: number; width?: number }) => void
  /** Always true: there is no session to wait for. */
  ready: ComputedRef<boolean>
  /** Always null. */
  session: Ref<SignedOutUserSession | null>
  /** Always null. */
  user: ComputedRef<SignedOutUser | null>
}

export function useUserSession(): SignedOutUserSessionComposable {
  return {
    clear: async () => {},
    fetch: async () => {},
    loggedIn: computed(() => false),
    openInPopup: () => {},
    ready: computed(() => true),
    session: ref<SignedOutUserSession | null>(null),
    user: computed(() => null),
  }
}
