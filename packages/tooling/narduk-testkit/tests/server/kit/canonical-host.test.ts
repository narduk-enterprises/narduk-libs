import { registerCanonicalHostMiddlewareTests } from '../../../src/server/kit/canonical-host'

interface StubEvent {
  headers?: Record<string, string | undefined>
  method: string
  url: string
}

registerCanonicalHostMiddlewareTests(async () => {
  const { getRequestHeader, getRequestURL, sendRedirect } = await import('h3')

  const handler = (event: StubEvent) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') return

    const config = (
      globalThis as unknown as {
        useRuntimeConfig: () => { public: { appUrl: string; enforceCanonicalHost: boolean } }
      }
    ).useRuntimeConfig()

    if (!config.public.enforceCanonicalHost) return
    const appUrl = config.public.appUrl.trim()
    if (!appUrl) return

    const canonicalUrl = new URL(appUrl)
    const requestHost = (getRequestHeader(event as never, 'host') ?? '')
      .split(',')[0]
      ?.trim()
      .toLowerCase()
    const canonicalHost = canonicalUrl.host.toLowerCase()
    const requestUrl = getRequestURL(event as never)
    if (
      !requestHost ||
      (requestHost === canonicalHost && requestUrl.protocol === canonicalUrl.protocol)
    ) {
      return
    }

    const redirectUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`,
      canonicalUrl,
    )

    return sendRedirect(event as never, redirectUrl.toString(), 308)
  }

  return { default: handler as (event: StubEvent) => unknown }
})
