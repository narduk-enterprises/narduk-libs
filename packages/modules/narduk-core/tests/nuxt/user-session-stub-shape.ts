/**
 * Compile-time proof (narduk-libs#169) that core's signed-out `useUserSession`
 * can stand in for `nuxt-auth-utils`' composable: this file is in the Nuxt app
 * tsconfig (`tests/nuxt/**`), where `#auth-utils` resolves, so `pnpm typecheck`
 * fails if the stub's return shape drifts from `UserSessionComposable`. Core's
 * dashboard components call it under either registration.
 */
import { useUserSession as useSignedOutUserSession } from '../../runtime/app/session/useUserSessionStub'

import type { UserSessionComposable } from '#auth-utils'

export const signedOutUserSessionMatchesAuthUtils: () => UserSessionComposable =
  useSignedOutUserSession
