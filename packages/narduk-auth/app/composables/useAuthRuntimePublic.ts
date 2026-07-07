export function useAuthRuntimePublic() {
  return useFetch<{
    authBackend: 'local' | 'supabase'
    authProviders: string[]
  }>('/api/auth/runtime-public', {
    key: 'auth-runtime-public',
  })
}
