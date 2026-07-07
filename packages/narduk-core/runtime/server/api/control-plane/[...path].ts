import { createError, defineEventHandler, getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { buildControlPlaneUpstreamUrl } from '../../../shared/controlPlaneProxy'

const ALLOWED_METHODS = new Set(['GET', 'HEAD'])
const BLOCKED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function filterProxyResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers()
  const connectionHeaderTokens = new Set(
    (headers.get('connection') ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )
  for (const [key, value] of headers.entries()) {
    const normalizedKey = key.toLowerCase()
    if (
      !BLOCKED_RESPONSE_HEADERS.has(normalizedKey) &&
      !connectionHeaderTokens.has(normalizedKey)
    ) {
      filtered.set(key, value)
    }
  }
  return filtered
}

export default defineEventHandler(async (event) => {
  const method = event.method.toUpperCase()
  if (!ALLOWED_METHODS.has(method)) {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
    })
  }

  const config = useRuntimeConfig(event)
  const requestUrl = getRequestURL(event)
  const upstreamUrl = buildControlPlaneUpstreamUrl(
    event.context.params?.path,
    requestUrl.search,
    config.public.controlPlaneUrl,
  )

  if (!upstreamUrl) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Control plane route is not configured',
    })
  }

  try {
    const response = await fetch(upstreamUrl, { method })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: filterProxyResponseHeaders(response.headers),
    })
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to reach control plane',
    })
  }
})
