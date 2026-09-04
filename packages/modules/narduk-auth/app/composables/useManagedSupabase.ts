import { useManagedSupabaseClient } from './useManagedSupabaseClient'
import { useManagedSupabaseConfig } from './useManagedSupabaseConfig'
import { useManagedSupabaseRpc } from './useManagedSupabaseRpc'
import { useManagedSupabaseStorage } from './useManagedSupabaseStorage'

import type {
  DefaultManagedSupabaseDatabase,
  ManagedSupabaseDatabaseLike,
} from '../utils/managedSupabase'

export function useManagedSupabase<
  Database extends ManagedSupabaseDatabaseLike = DefaultManagedSupabaseDatabase,
>() {
  const state = useManagedSupabaseConfig()

  return {
    ...state,
    client: state.enabled ? useManagedSupabaseClient<Database>() : null,
    rpc: state.enabled ? useManagedSupabaseRpc<Database>() : null,
    storage: state.enabled ? useManagedSupabaseStorage<Database>() : null,
  }
}
