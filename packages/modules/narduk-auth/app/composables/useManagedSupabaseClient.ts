import {
  createManagedSupabaseBrowserClient,
  type DefaultManagedSupabaseDatabase,
  type ManagedSupabaseClient,
  type ManagedSupabaseClientHost,
  type ManagedSupabaseDatabaseLike,
  requireManagedSupabaseState,
  resolveManagedSupabaseState,
} from '../utils/managedSupabase'

export function useManagedSupabaseClient<
  Database extends ManagedSupabaseDatabaseLike = DefaultManagedSupabaseDatabase,
>() {
  const state = resolveManagedSupabaseState()
  requireManagedSupabaseState(state)

  const nuxtApp = useNuxtApp() as ManagedSupabaseClientHost
  nuxtApp._managedSupabaseClient ??= createManagedSupabaseBrowserClient<Database>(
    state,
  ) as unknown as ManagedSupabaseClient<DefaultManagedSupabaseDatabase>

  return nuxtApp._managedSupabaseClient as unknown as ManagedSupabaseClient<Database>
}
