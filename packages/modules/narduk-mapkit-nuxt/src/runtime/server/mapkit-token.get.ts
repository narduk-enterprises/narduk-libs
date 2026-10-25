import { mapKitRoutedOrigin, mapKitTokenResponse } from '@narduk-enterprises/narduk-mapkit/worker'
import { useRuntimeConfig } from '#imports'
import { defineEventHandler, getRequestHeaders, getRequestURL } from 'h3'

import { readMapKitRuntimeString } from './runtime-env'

import type { MapKitRateLimitHook } from '@narduk-enterprises/narduk-mapkit/worker'
import type { H3Event } from 'h3'
import type { MapKitRuntimeEnv } from './runtime-env'

function readProcessEnv(): MapKitRuntimeEnv {
  const processValue = Reflect.get(globalThis, 'process') as { env?: MapKitRuntimeEnv } | undefined
  return processValue?.env ?? {}
}

function readCloudflareEnv(event: H3Event): MapKitRuntimeEnv {
  const context = event.context as {
    _platform?: { cloudflare?: { env?: MapKitRuntimeEnv } }
    cloudflare?: { env?: MapKitRuntimeEnv }
  }
  return context.cloudflare?.env ?? context._platform?.cloudflare?.env ?? {}
}

function requestFromEvent(event: H3Event): Request {
  // A web/workerd adapter (Cloudflare, the estate's target) already holds the
  // routed Fetch Request. Nothing reconstructed from headers can be more
  // faithful than the real one.
  const webRequest = event.web?.request
  if (webRequest) return webRequest

  const headers = new Headers()
  for (const [name, value] of Object.entries(getRequestHeaders(event))) {
    if (value) headers.set(name, value)
  }
  // The real method: the handler answers 405 itself, so a POST must not be
  // laundered into a GET on the way in.
  return new Request(getRequestURL(event), { headers, method: event.method })
}

/**
 * §e.1's `self`.
 *
 * `xForwardedHost: false` keeps an `X-Forwarded-Host` out of the claim.
 * `mapKitRoutedOrigin` prefers the routed Fetch Request where one exists and
 * refuses an absolute-form request line where one does not -- h3 itself
 * documents `getRequestURL().origin` as spoofable. `null` reaches the handler
 * as a 403, never as a guess.
 */
function routedOrigin(event: H3Event): string | null {
  return mapKitRoutedOrigin({
    derivedOrigin: getRequestURL(event, { xForwardedHost: false }).origin,
    request: event.web?.request,
    // Exactly what `getRequestURL` reads, before `new URL(target, base)` can
    // ignore the base.
    requestTarget: event.node.req.originalUrl ?? event.path,
  })
}

/**
 * `MAPKIT_ALLOWED_ORIGINS` as the package's `allowedHosts`: each origin's host,
 * or the entry itself when it is already a bare host. Empty allows every host,
 * as before; a forged `Host` on a Node listener is refused otherwise.
 */
function allowedHostsFrom(origins: string): string[] {
  return origins
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      // Only a full origin is parsed: `new URL('app.example:8443')` reads
      // `app.example:` as a scheme and yields an empty host.
      if (!entry.includes('://')) return entry
      try {
        return new URL(entry).host
      } catch {
        return entry
      }
    })
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const envSources = [readCloudflareEnv(event), readProcessEnv()]
  const rateLimit = (
    event.context as {
      nardukMapKit?: { rateLimit?: MapKitRateLimitHook }
    }
  ).nardukMapKit?.rateLimit

  // The whole response -- status, body, `cache-control`, `vary`, `allow`,
  // `retry-after` -- comes from the package handler, so the adapter cannot
  // drift from narduk-libs#421 §e.2 by assembling headers of its own.
  return await mapKitTokenResponse(
    requestFromEvent(event),
    {
      allowedHosts: allowedHostsFrom(
        readMapKitRuntimeString(
          envSources,
          ['MAPKIT_ALLOWED_ORIGINS'],
          config.mapkitAllowedOrigins,
        ),
      ),
      doppler: false,
      keyId: readMapKitRuntimeString(envSources, ['APPLE_KEY_ID'], config.appleKeyId),
      privateKey: readMapKitRuntimeString(
        envSources,
        ['APPLE_PRIVATE_KEY', 'APPLE_SECRET_KEY'],
        config.applePrivateKey || config.appleSecretKey,
      ),
      teamId: readMapKitRuntimeString(envSources, ['APPLE_TEAM_ID'], config.appleTeamId),
    },
    {
      ...(rateLimit ? { rateLimit } : {}),
      // The routed origin, never a forwarded host header nor a request line
      // that names its own host (§e.1).
      self: routedOrigin(event),
    },
  )
})
