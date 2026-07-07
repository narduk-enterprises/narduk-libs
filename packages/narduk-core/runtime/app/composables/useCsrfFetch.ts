/**
 * useCsrfFetch — Zero-boilerplate $fetch wrapper with automatic CSRF header.
 *
 * Returns a $fetch instance that automatically injects the
 * `X-Requested-With: XMLHttpRequest` header on all same-origin mutation
 * requests (POST, PUT, PATCH, DELETE).
 *
 * Use this in composables instead of raw `$fetch` to avoid manual header
 * injection on every mutation call:
 *
 * ```ts
 * const fetch = useCsrfFetch()
 * await fetch('/api/items', { method: 'POST', body: payload })
 * ```
 *
 * For Pinia stores, prefer `useAppFetch()` which also handles SSR cookie
 * forwarding via `useRequestFetch()`.
 */

import { MUTATION_METHODS } from '../utils/mutationMethods'

export function useCsrfFetch() {
  return $fetch.create({
    onRequest({ options, request }) {
      if (typeof request !== 'string' || !request.startsWith('/')) return
      const method = (options.method ?? 'GET').toString().toUpperCase()
      if (!MUTATION_METHODS.has(method)) return

      const headers = new Headers(options.headers as HeadersInit)
      if (!headers.has('X-Requested-With')) {
        headers.set('X-Requested-With', 'XMLHttpRequest')
      }
      options.headers = headers
    },
  })
}
