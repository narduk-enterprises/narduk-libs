// `@supabase/supabase-js` is declared as a devDependency on this package so the
// fixture resolves against real types and the behavior test's `vi.doMock` cleanly
// intercepts the same module id at runtime.
import { createClient } from '@supabase/supabase-js'

import { getCurrentSupabaseContext } from './app-auth-stub'

interface Config {
  public: {
    appBackendPreset: string
    authBackend: string
  }
  supabasePublishableKey: string
  supabaseServiceRoleKey: string
  supabaseUrl: string
}

declare const useRuntimeConfig: () => Config

function readConfig() {
  const config = useRuntimeConfig()
  return {
    preset: config.public.appBackendPreset,
    enabled: config.public.appBackendPreset === 'managed-supabase',
    url: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
    serviceRoleKey: config.supabaseServiceRoleKey,
    authBackend: config.public.authBackend,
  }
}

export function getManagedSupabaseConfig() {
  return readConfig()
}

export function isManagedSupabasePresetEnabled() {
  return readConfig().enabled
}

function requirePreset() {
  const config = readConfig()
  if (!config.enabled) {
    throw new Error('Managed Supabase helpers require APP_BACKEND_PRESET=managed-supabase.')
  }
  return config
}

export function useManagedSupabasePublicClient(_event: unknown) {
  const config = requirePreset()
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export function useManagedSupabaseServiceRoleClient(_event: unknown) {
  const config = requirePreset()
  return createClient(config.url, config.serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${config.serviceRoleKey}` } },
  })
}

export async function useManagedSupabaseUserClient(event: unknown) {
  const config = requirePreset()
  const context = await getCurrentSupabaseContext(event)
  return createClient(config.url, config.publishableKey, {
    global: {
      headers: {
        Authorization: `Bearer ${context.session.access_token}`,
      },
    },
  })
}
