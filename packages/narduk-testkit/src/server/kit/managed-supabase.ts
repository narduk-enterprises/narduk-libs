import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MOCK_SUPABASE_URL = 'https://project.supabase.co'
const MOCK_PUBLISHABLE_KEY = 'publishable-key'
const MOCK_SERVICE_ROLE_KEY = 'service-role-key'

interface ManagedSupabaseModule {
  getManagedSupabaseConfig: () => {
    authBackend: string
    enabled: boolean
    preset: string
    publishableKey: string
    serviceRoleKey: string
    url: string
  }
  isManagedSupabasePresetEnabled: () => boolean
  useManagedSupabasePublicClient: (event: unknown) => unknown
  useManagedSupabaseServiceRoleClient: (event: unknown) => unknown
  useManagedSupabaseUserClient: (event: unknown) => Promise<unknown>
}

type LoadManagedSupabaseModule = () => Promise<ManagedSupabaseModule> | ManagedSupabaseModule

interface ManagedSupabaseKitOptions {
  appAuthModuleId?: string
  describeName?: string
}

/**
 * Register vitest coverage for the fleet's managed-supabase server helpers.
 * Apps wire the factory to the module copy shipped by the auth package:
 *
 *   import { registerManagedSupabaseHelperTests } from '@narduk-enterprises/narduk-testkit/server/kit/managed-supabase'
 *   registerManagedSupabaseHelperTests(() =>
 *     import('@narduk-enterprises/narduk-auth/server/utils/supabase'),
 *   )
 */
export function registerManagedSupabaseHelperTests(
  loadModule: LoadManagedSupabaseModule,
  options: ManagedSupabaseKitOptions = {},
) {
  const {
    describeName = 'managed Supabase server helpers',
    appAuthModuleId = '@narduk-enterprises/narduk-auth/server/utils/app-auth',
  } = options

  const mockCreateClient = vi.fn((..._args: unknown[]) => ({
    from: vi.fn((table: string) => ({ table })),
    rpc: vi.fn((fn: string) => ({ fn })),
    storage: {
      from: vi.fn((bucket: string) => ({ bucket })),
    },
  }))
  const mockGetCurrentSupabaseContext = vi.fn()
  const mockUseRuntimeConfig = vi.fn(() => ({
    supabaseUrl: MOCK_SUPABASE_URL,
    supabasePublishableKey: MOCK_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
    public: {
      appBackendPreset: 'managed-supabase',
      authBackend: 'supabase',
    },
  }))

  describe(describeName, () => {
    let helpers: ManagedSupabaseModule

    beforeEach(async () => {
      vi.resetModules()
      vi.clearAllMocks()

      mockUseRuntimeConfig.mockReturnValue({
        supabaseUrl: MOCK_SUPABASE_URL,
        supabasePublishableKey: MOCK_PUBLISHABLE_KEY,
        supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
        public: {
          appBackendPreset: 'managed-supabase',
          authBackend: 'supabase',
        },
      })
      mockGetCurrentSupabaseContext.mockResolvedValue({
        session: {
          access_token: 'user-access-token',
        },
      })

      vi.doMock('@supabase/supabase-js', () => ({
        createClient: (...args: unknown[]) => mockCreateClient(...args),
      }))
      vi.doMock(appAuthModuleId, () => ({
        getCurrentSupabaseContext: (...args: unknown[]) => mockGetCurrentSupabaseContext(...args),
      }))

      vi.stubGlobal('createError', (opts: { statusCode?: number; statusMessage?: string }) => {
        const error = new Error(opts.statusMessage ?? 'error') as Error & {
          statusCode?: number
        }
        error.statusCode = opts.statusCode
        return error
      })
      vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)

      helpers = await loadModule()
    })

    afterEach(() => {
      // Apps import this factory into their own test suites, so unwind every
      // global/module patched in `beforeEach` to avoid leaking stubs into
      // unrelated tests or creating order-dependent failures.
      vi.unstubAllGlobals()
      vi.doUnmock('@supabase/supabase-js')
      vi.doUnmock(appAuthModuleId)
    })

    it('reads the managed Supabase preset config from runtime config', () => {
      expect(helpers.getManagedSupabaseConfig()).toEqual({
        preset: 'managed-supabase',
        enabled: true,
        url: MOCK_SUPABASE_URL,
        publishableKey: MOCK_PUBLISHABLE_KEY,
        serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
        authBackend: 'supabase',
      })
      expect(helpers.isManagedSupabasePresetEnabled()).toBe(true)
    })

    it('creates a publishable client for public data access', () => {
      const event = { context: {} }
      const client = helpers.useManagedSupabasePublicClient(event) as {
        from: (table: string) => unknown
        rpc: (fn: string) => unknown
        storage: { from: (bucket: string) => unknown }
      }

      expect(mockCreateClient).toHaveBeenCalledWith(
        MOCK_SUPABASE_URL,
        MOCK_PUBLISHABLE_KEY,
        expect.objectContaining({
          auth: expect.objectContaining({
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          }),
        }),
      )
      expect(client.from('profiles')).toEqual({ table: 'profiles' })
      expect(client.rpc('healthcheck')).toEqual({ fn: 'healthcheck' })
      expect(client.storage.from('avatars')).toEqual({ bucket: 'avatars' })
    })

    it('creates a user-scoped client with the app session access token', async () => {
      const event = { context: {} }

      const client = (await helpers.useManagedSupabaseUserClient(event)) as {
        from: (table: string) => unknown
      }

      expect(mockGetCurrentSupabaseContext).toHaveBeenCalledTimes(1)
      expect(mockCreateClient).toHaveBeenCalledWith(
        MOCK_SUPABASE_URL,
        MOCK_PUBLISHABLE_KEY,
        expect.objectContaining({
          global: expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer user-access-token',
            }),
          }),
        }),
      )
      expect(client.from('profiles')).toEqual({ table: 'profiles' })
    })

    it('creates a service-role client for privileged operations', () => {
      const event = { context: {} }

      const client = helpers.useManagedSupabaseServiceRoleClient(event) as {
        storage: { from: (bucket: string) => unknown }
      }

      expect(mockCreateClient).toHaveBeenCalledWith(
        MOCK_SUPABASE_URL,
        MOCK_SERVICE_ROLE_KEY,
        expect.objectContaining({
          global: expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${MOCK_SERVICE_ROLE_KEY}`,
            }),
          }),
        }),
      )
      expect(client.storage.from('avatars')).toEqual({ bucket: 'avatars' })
    })

    it('throws when the preset is not enabled', () => {
      mockUseRuntimeConfig.mockReturnValue({
        supabaseUrl: '',
        supabasePublishableKey: '',
        supabaseServiceRoleKey: '',
        public: {
          appBackendPreset: 'default',
          authBackend: 'local',
        },
      })

      expect(() => helpers.useManagedSupabasePublicClient({ context: {} })).toThrow(
        'Managed Supabase helpers require APP_BACKEND_PRESET=managed-supabase.',
      )
    })
  })
}
