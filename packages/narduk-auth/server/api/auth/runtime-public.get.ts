import { defineEventHandler, setResponseHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readWorkerRuntimeEnv } from '#layer/server/utils/worker-env'

import { resolveAuthEnvironment } from '../../../shared/utils/auth-environment'

import type { H3Event } from 'h3'

function coerceStringEnv(env: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) {
      out[key] = undefined
    } else {
      out[key] = String(value)
    }
  }
  return out
}

function envFromProcessRuntime(): Record<string, string | undefined> {
  if (typeof process === 'undefined' || !process.env) {
    return {}
  }

  return coerceStringEnv(
    Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ) as Record<string, unknown>,
  )
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
 * Auth flags derived from **runtime** Worker env (Cloudflare bindings + local
 * process.env), not from values frozen at `nuxt build`. Client components use
 * this so OAuth affordances match production secrets without requiring those
 * vars during Workers Builds / `cf:build`.
 */
export default defineEventHandler((event) => {
  // readWorkerRuntimeEnv pulls from event.context.cloudflare.env (the
  // request-scoped Worker bindings provided by the Nitro cloudflare-module
  // preset) merged with process.env. We intentionally avoid a top-level
  // `import 'cloudflare:workers'` because Nitro's prerenderer loads modules
  // under Node's default ESM loader, which cannot resolve the `cloudflare:`
  // URL scheme and crashes the build.
  const fromH3 = readWorkerRuntimeEnv(event) as Record<string, unknown>
  const fromNuxt = envFromNuxtRuntime(event)
  const fromProcess = envFromProcessRuntime()
  // Lowest → highest priority so live Worker bindings win over build-time process env.
  const merged = { ...fromProcess, ...fromNuxt, ...fromH3 }
  const resolved = resolveAuthEnvironment(coerceStringEnv(merged))
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return {
    authBackend: resolved.authBackend,
    authProviders: resolved.authProviders,
  }
})
