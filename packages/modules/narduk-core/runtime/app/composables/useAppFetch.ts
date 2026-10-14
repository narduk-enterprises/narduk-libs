/**
 * useAppFetch — SSR-safe fetch wrapper with automatic CSRF header injection.
 *
 * Wraps `useRequestFetch()` for SSR cookie/auth forwarding and automatically
 * adds the `X-Requested-With: XMLHttpRequest` header on mutation methods
 * (POST, PUT, PATCH, DELETE). Use this in Pinia stores instead of raw `$fetch`.
 */

import { useRequestFetch } from '#imports'

import { MUTATION_METHODS } from '../utils/mutationMethods'

export function useAppFetch() {
  const requestFetch = useRequestFetch()
  // Nuxt 4.6 narrows `useRequestFetch()`'s `method` and `baseURL` options to
  // route-derived literals, which the caller's runtime options (typed from the
  // same signature, then spread) cannot satisfy. The public signature below
  // stays tied to `requestFetch`; only the internal call is loosened (#1696).
  const untypedFetch = requestFetch as unknown as (
    request: unknown,
    options?: unknown,
  ) => Promise<unknown>

  return async <T>(
    request: Parameters<typeof requestFetch>[0],
    options?: Parameters<typeof requestFetch>[1],
  ) => {
    const opts = { ...options }
    const method = (opts.method ?? 'GET').toString().toUpperCase()

    // Auto-inject CSRF header on mutation methods
    if (MUTATION_METHODS.has(method)) {
      const headers = new Headers(opts.headers as HeadersInit)
      if (!headers.has('X-Requested-With')) {
        headers.set('X-Requested-With', 'XMLHttpRequest')
      }
      opts.headers = headers
    }

    return (await untypedFetch(request, opts)) as T
  }
}
