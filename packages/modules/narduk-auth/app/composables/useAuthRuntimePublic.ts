import type { AuthRuntimePublic } from '../internal/auth-api-types'

export function useAuthRuntimePublic() {
  return useFetch<AuthRuntimePublic>('/api/auth/runtime-public', {
    key: 'auth-runtime-public',
  })
}
