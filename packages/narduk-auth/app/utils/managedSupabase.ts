import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type AppBackendPreset = 'default' | 'managed-supabase'

/** @internal Exported for colocated managed Supabase helpers. */
export interface ManagedSupabaseState {
  enabled: boolean
  preset: AppBackendPreset
  publishableKey: string
  url: string
}

interface SupabaseRelationship {
  columns: string[]
  foreignKeyName: string
  isOneToOne?: boolean
  referencedColumns: string[]
  referencedRelation: string
}

interface SupabaseTable {
  Insert: Record<string, unknown>
  Relationships: SupabaseRelationship[]
  Row: Record<string, unknown>
  Update: Record<string, unknown>
}

interface SupabaseView {
  Insert?: Record<string, unknown>
  Relationships: SupabaseRelationship[]
  Row: Record<string, unknown>
  Update?: Record<string, unknown>
}

interface SupabaseFunction {
  Args: Record<string, unknown> | never
  Returns: unknown
}

export interface ManagedSupabaseDatabaseLike {
  public: {
    Functions: Record<string, SupabaseFunction>
    Tables: Record<string, SupabaseTable>
    Views: Record<string, SupabaseView>
  }
}

export interface DefaultManagedSupabaseDatabase {
  public: {
    Functions: Record<string, never>
    Tables: Record<string, never>
    Views: Record<string, never>
  }
}

export type ManagedSupabaseClient<Database extends ManagedSupabaseDatabaseLike> =
  SupabaseClient<Database>

export type ManagedSupabaseClientHost = ReturnType<typeof useNuxtApp> & {
  _managedSupabaseClient?: ManagedSupabaseClient<DefaultManagedSupabaseDatabase>
}

export function resolveManagedSupabaseState(): ManagedSupabaseState {
  const config = useRuntimeConfig()
  const preset =
    config.public.appBackendPreset === 'managed-supabase' ? 'managed-supabase' : 'default'

  return {
    preset,
    enabled:
      preset === 'managed-supabase' &&
      Boolean(config.public.supabaseUrl && config.public.supabasePublishableKey),
    url: config.public.supabaseUrl.trim(),
    publishableKey: config.public.supabasePublishableKey,
  }
}

export function createManagedSupabaseBrowserClient<Database extends ManagedSupabaseDatabaseLike>(
  state: ManagedSupabaseState,
): ManagedSupabaseClient<Database> {
  const client = createClient(state.url, state.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        apikey: state.publishableKey,
      },
    },
  } as const)

  return client as unknown as ManagedSupabaseClient<Database>
}

export function requireManagedSupabaseState(state: ManagedSupabaseState) {
  if (!state.enabled) {
    throw new Error(
      'Managed Supabase client access requires APP_BACKEND_PRESET=managed-supabase and public Supabase credentials.',
    )
  }
}
