import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface AuthSessionRefreshEvent {
  path: string
}

type AuthSessionRefreshHandler = (event: AuthSessionRefreshEvent) => Promise<void> | void

interface AuthSessionRefreshHandlerModule {
  default: AuthSessionRefreshHandler
}

type LoadAuthSessionRefreshHandler = () =>
  Promise<AuthSessionRefreshHandlerModule> | AuthSessionRefreshHandlerModule

interface AuthSessionRefreshKitOptions {
  describeName?: string
  sessionUserModuleId?: string
  sessionUserModuleIds?: string[]
}

/**
 * Register vitest coverage for the fleet's shared auth-session-refresh
 * middleware. Prefer the auth package export; point at an app-local
 * module only while covering a legacy downstream migration:
 *
 *   import { registerAuthSessionRefreshTests } from '@narduk-enterprises/narduk-testkit/server/kit/auth-session-refresh'
 *   registerAuthSessionRefreshTests(() => import('@narduk-enterprises/narduk-auth/server/middleware/auth-session-refresh'))
 */
export function registerAuthSessionRefreshTests(
  loadHandler: LoadAuthSessionRefreshHandler,
  options: AuthSessionRefreshKitOptions = {},
) {
  const {
    describeName = 'auth-session-refresh middleware',
    sessionUserModuleId = '@narduk-enterprises/narduk-auth/server/utils/session-user',
    sessionUserModuleIds = [],
  } = options
  const sessionUserModuleMockIds = [sessionUserModuleId, ...sessionUserModuleIds]

  const mockUseRefreshedSessionUser = vi.fn().mockResolvedValue(null)

  describe(describeName, () => {
    let handler: AuthSessionRefreshHandler

    beforeEach(async () => {
      vi.resetModules()
      vi.clearAllMocks()
      mockUseRefreshedSessionUser.mockResolvedValue(null)

      for (const moduleId of sessionUserModuleMockIds) {
        vi.doMock(moduleId, () => ({
          useRefreshedSessionUser: mockUseRefreshedSessionUser,
        }))
      }
      vi.stubGlobal(
        'defineEventHandler',
        (fn: (event: AuthSessionRefreshEvent) => Promise<void> | void) => fn,
      )

      const loaded = await loadHandler()
      handler = loaded.default
    })

    afterEach(() => {
      // Downstream apps run this factory alongside their own server test
      // suites, so restore every global/module patched in `beforeEach` to
      // avoid cross-test pollution and order-dependent failures.
      vi.unstubAllGlobals()
      for (const moduleId of sessionUserModuleMockIds) {
        vi.doUnmock(moduleId)
      }
    })

    it('refreshes shared auth state before admin API reads', async () => {
      await handler({ path: '/api/admin/users' })

      expect(mockUseRefreshedSessionUser).toHaveBeenCalledTimes(1)
    })

    it('refreshes shared auth state before auth/me reads', async () => {
      await handler({ path: '/api/auth/me' })

      expect(mockUseRefreshedSessionUser).toHaveBeenCalledTimes(1)
    })

    it('skips unrelated routes', async () => {
      await handler({ path: '/api/auth/login' })

      expect(mockUseRefreshedSessionUser).not.toHaveBeenCalled()
    })
  })
}
