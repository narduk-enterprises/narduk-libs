import { defineNuxtPlugin, useNuxtApp } from '#imports'

/**
 * Global fetch/$fetch interceptor.
 *
 * - Automatically adds the `X-Requested-With: XMLHttpRequest` header to
 *   same-origin mutation requests to satisfy the shared CSRF middleware.
 */
import { MUTATION_METHODS } from '../utils/mutationMethods'

function getRequestUrl(request: RequestInfo | URL): string | undefined {
  if (typeof request === 'string') return request
  if (request instanceof URL) return request.href
  if (request instanceof Request) return request.url
  return undefined
}

function isSameOriginRequest(requestUrl: string | undefined, currentOrigin: string): boolean {
  if (!requestUrl) return false
  if (requestUrl.startsWith('/')) return true

  try {
    return new URL(requestUrl, currentOrigin).origin === currentOrigin
  } catch {
    return false
  }
}

export default defineNuxtPlugin(() => {
  const nuxtApp = useNuxtApp()
  const currentOrigin = window.location.origin

  const fetchWithCsrf = $fetch.create({
    onRequest(context) {
      const method = (context.options.method ?? 'GET').toString().toUpperCase()
      if (!MUTATION_METHODS.has(method)) return

      if (!isSameOriginRequest(getRequestUrl(context.request), currentOrigin)) return

      const headers = new Headers(context.options.headers as HeadersInit)
      if (!headers.has('X-Requested-With')) {
        headers.set('X-Requested-With', 'XMLHttpRequest')
      }
      context.options.headers = headers
    },
  })

  globalThis.$fetch = fetchWithCsrf as typeof globalThis.$fetch

  if ('$csrfFetch' in nuxtApp) {
    return
  }

  return { provide: { csrfFetch: fetchWithCsrf } }
})
