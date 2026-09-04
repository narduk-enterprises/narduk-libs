import { fileURLToPath } from 'node:url'

import { registerManagedSupabaseHelperTests } from '../../../src/server/kit/managed-supabase'

const APP_AUTH_STUB = fileURLToPath(new URL('./__fixtures__/app-auth-stub.ts', import.meta.url))
const SUPABASE_STUB = fileURLToPath(
  new URL('./__fixtures__/managed-supabase-stub.ts', import.meta.url),
)

registerManagedSupabaseHelperTests(
  async () => {
    const stub = (await import(SUPABASE_STUB)) as unknown as {
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
    return stub
  },
  {
    describeName: 'managed-supabase kit (behavior test)',
    appAuthModuleId: APP_AUTH_STUB,
  },
)
