import { useRuntimeConfig } from 'nitropack/runtime'

import { readWorkerRuntimeEnv } from '#layer/server/utils/worker-env'

import {
  resolveAuthEnvironment,
  type ResolvedAuthEnvironment,
} from '../../shared/utils/auth-environment'

import type { H3Event } from 'h3'

function coerceStringEnv(env: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    out[key] = value === undefined || value === null ? undefined : String(value)
  }
  return out
}

/** Same fields `resolveAuthEnvironment` reads, sourced from Nitro server runtimeConfig. */
function envFromNuxtRuntime(event: H3Event): Record<string, string | undefined> {
  const c = useRuntimeConfig(event) as Record<string, unknown>
  const pub = (c.public as Record<string, unknown> | undefined) ?? {}
  const out: Record<string, string | undefined> = {}

  const set = (key: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) out[key] = value
  }

  set('AUTH_BACKEND', pub.authBackend ?? c.authBackend)
  set('AUTH_AUTHORITY_URL', c.authAuthorityUrl)
  set('SUPABASE_URL', c.supabaseUrl)
  set('AUTH_ANON_KEY', c.authAnonKey)
  set('SUPABASE_PUBLISHABLE_KEY', c.supabasePublishableKey)
  set('APP_BACKEND_PRESET', c.appBackendPreset)

  const providers = pub.authProviders
  if (Array.isArray(providers) && providers.length) {
    out.AUTH_PROVIDERS = providers.map((p) => String(p)).join(',')
  }

  return out
}

/**
 * The auth-relevant environment as the **running Worker** sees it.
 *
 * `nuxt build` freezes `runtimeConfig` from the build host's `process.env`,
 * which for a Cloudflare Workers Build is not the environment the request runs
 * in — Worker `vars` and secrets only exist at request time on
 * `event.context.cloudflare.env`. Anything that gates an auth affordance must
 * therefore resolve here, with live bindings winning over the frozen values,
 * rather than reading `runtimeConfig` directly.
 *
 * `readWorkerRuntimeEnv` already returns `{ ...process.env, ...cloudflareBindings }`,
 * so no separate lowest-priority `process.env` layer is needed — and omitting it
 * keeps this file free of the direct `process.env` read that
 * `narduk/no-process-env-in-worker-runtime` forbids in Worker runtime code.
 */
export function readAuthRuntimeEnv(event: H3Event): Record<string, string | undefined> {
  const fromH3 = readWorkerRuntimeEnv(event) as Record<string, unknown>
  const fromNuxt = envFromNuxtRuntime(event)
  return coerceStringEnv({ ...fromNuxt, ...fromH3 })
}

export function resolveAuthEnvironmentForEvent(event: H3Event): ResolvedAuthEnvironment {
  return resolveAuthEnvironment(readAuthRuntimeEnv(event))
}
