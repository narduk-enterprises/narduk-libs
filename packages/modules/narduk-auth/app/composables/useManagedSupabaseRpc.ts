import { useManagedSupabaseClient } from './useManagedSupabaseClient'

import type {
  DefaultManagedSupabaseDatabase,
  ManagedSupabaseDatabaseLike,
} from '../utils/managedSupabase'

export function useManagedSupabaseRpc<
  Database extends ManagedSupabaseDatabaseLike = DefaultManagedSupabaseDatabase,
>() {
  const client = useManagedSupabaseClient<Database>()
  return client.rpc.bind(client)
}
