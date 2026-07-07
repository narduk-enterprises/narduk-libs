import { useManagedSupabaseClient } from './useManagedSupabaseClient'

import type {
  DefaultManagedSupabaseDatabase,
  ManagedSupabaseDatabaseLike,
} from '../utils/managedSupabase'

export function useManagedSupabaseStorage<
  Database extends ManagedSupabaseDatabaseLike = DefaultManagedSupabaseDatabase,
>() {
  return useManagedSupabaseClient<Database>().storage
}
