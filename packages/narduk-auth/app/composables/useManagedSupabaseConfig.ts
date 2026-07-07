import { resolveManagedSupabaseState } from '../utils/managedSupabase'

export function useManagedSupabaseConfig() {
  return resolveManagedSupabaseState()
}
