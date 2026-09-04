import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { getCurrentSupabaseContext } from './app-auth'

import type { AppBackendPreset } from '../../shared/utils/auth-environment'
import type { H3Event } from 'h3'

export interface ManagedSupabaseConfig {
  authBackend: 'local' | 'supabase'
  enabled: boolean
  preset: AppBackendPreset
  publishableKey: string
  serviceRoleKey: string
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

interface DefaultManagedSupabaseDatabase {
  public: {
    Functions: Record<string, never>
    Tables: Record<string, never>
    Views: Record<string, never>
  }
}

type ManagedSupabaseClient<Database extends ManagedSupabaseDatabaseLike> = SupabaseClient<Database>

type ManagedH3Supabase = SupabaseClient<ManagedSupabaseDatabaseLike>

function readRuntimeConfig(event?: H3Event) {
  return event ? useRuntimeConfig(event) : useRuntimeConfig()
}

function normalizePreset(value: string | undefined): AppBackendPreset {
  return value === 'managed-supabase' ? 'managed-supabase' : 'default'
}

function createManagedClient<Database extends ManagedSupabaseDatabaseLike>(
  url: string,
  key: string,
  options: SupabaseClientOptions<'public'> = {},
): ManagedSupabaseClient<Database> {
  const auth = options.auth ?? {}
  const global = options.global ?? {}
  const headers =
    global.headers && typeof global.headers === 'object'
      ? (global.headers as Record<string, string>)
      : {}

  const client = createClient(url, key, {
    ...options,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      ...auth,
    },
    global: {
      ...global,
      headers: {
        apikey: key,
        ...headers,
      },
    },
  } as SupabaseClientOptions<'public'>)

  return client as unknown as ManagedSupabaseClient<Database>
}

export function getManagedSupabaseConfig(event?: H3Event): ManagedSupabaseConfig {
  const config = readRuntimeConfig(event)

  return {
    preset: normalizePreset(config.public.appBackendPreset),
    enabled:
      normalizePreset(config.public.appBackendPreset) === 'managed-supabase' &&
      Boolean(config.supabaseUrl && config.supabasePublishableKey),
    url: config.supabaseUrl.trim(),
    publishableKey: config.supabasePublishableKey,
    serviceRoleKey: config.supabaseServiceRoleKey,
    authBackend: config.public.authBackend === 'supabase' ? 'supabase' : 'local',
  }
}

export function isManagedSupabasePresetEnabled(event?: H3Event) {
  return getManagedSupabaseConfig(event).enabled
}

function requireManagedSupabaseConfig(
  event: H3Event,
  options: {
    requireServiceRole?: boolean
  } = {},
) {
  const config = getManagedSupabaseConfig(event)

  if (config.preset !== 'managed-supabase') {
    throw createError({
      statusCode: 501,
      statusMessage: 'Managed Supabase helpers require APP_BACKEND_PRESET=managed-supabase.',
    })
  }

  if (!config.url || !config.publishableKey) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Managed Supabase is enabled but SUPABASE_URL and a publishable/anon key are not configured.',
    })
  }

  if (options.requireServiceRole && !config.serviceRoleKey) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Managed Supabase service-role access requires SUPABASE_SERVICE_ROLE_KEY to be configured.',
    })
  }

  return config
}

export function useManagedSupabasePublicClient<
  Database extends ManagedSupabaseDatabaseLike = DefaultManagedSupabaseDatabase,
>(event: H3Event) {
  if (event.context._managedSupabasePublicClient) {
    return event.context._managedSupabasePublicClient as ManagedSupabaseClient<Database>
  }

  const config = requireManagedSupabaseConfig(event)
  const client = createManagedClient<Database>(config.url, config.publishableKey)
  event.context._managedSupabasePublicClient = client as ManagedH3Supabase
  return client
}

export async function useManagedSupabaseUserClient<
  Database extends ManagedSupabaseDatabaseLike = DefaultManagedSupabaseDatabase,
>(event: H3Event) {
  if (event.context._managedSupabaseUserClient) {
    return event.context._managedSupabaseUserClient as ManagedSupabaseClient<Database>
  }

  const config = requireManagedSupabaseConfig(event)
  const context = await getCurrentSupabaseContext(event)
  const client = createManagedClient<Database>(config.url, config.publishableKey, {
    global: {
      headers: {
        Authorization: `Bearer ${context.session.access_token}`,
      },
    },
  })

  event.context._managedSupabaseUserClient = client as ManagedH3Supabase
  return client
}

export function useManagedSupabaseServiceRoleClient<
  Database extends ManagedSupabaseDatabaseLike = DefaultManagedSupabaseDatabase,
>(event: H3Event) {
  if (event.context._managedSupabaseServiceRoleClient) {
    return event.context._managedSupabaseServiceRoleClient as ManagedSupabaseClient<Database>
  }

  const config = requireManagedSupabaseConfig(event, { requireServiceRole: true })
  const client = createManagedClient<Database>(config.url, config.serviceRoleKey, {
    global: {
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    },
  })

  event.context._managedSupabaseServiceRoleClient = client as ManagedH3Supabase
  return client
}
