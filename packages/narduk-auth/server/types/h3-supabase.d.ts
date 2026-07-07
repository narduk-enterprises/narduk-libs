import 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManagedSupabaseDatabaseLike } from '../utils/supabase'

type ManagedH3Supabase = SupabaseClient<ManagedSupabaseDatabaseLike>

declare module 'h3' {
  interface H3EventContext {
    _managedSupabasePublicClient?: ManagedH3Supabase
    _managedSupabaseUserClient?: ManagedH3Supabase
    _managedSupabaseServiceRoleClient?: ManagedH3Supabase
  }
}
