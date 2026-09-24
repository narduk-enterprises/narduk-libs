import { readStoredCloudflareContext } from './cloudflare-request-env'

import type { H3Event } from 'h3'

export type WorkerRuntimeEnv = Record<string, unknown>

/** Cloudflare `env` may not enumerate with `Object.entries` / object spread. */
function copyWorkerBindings(source: unknown): WorkerRuntimeEnv {
  if (!source || typeof source !== 'object') return {}
  const out: WorkerRuntimeEnv = {}
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string') continue
    try {
      out[key] = (source as Record<string, unknown>)[key]
    } catch {
      // Non-data bindings can throw on access in some runtimes; skip.
    }
  }
  return out
}

function getCloudflareEnvFromEvent(event: H3Event): unknown {
  const ctx = event.context as
    | {
        _platform?: { cloudflare?: { env?: unknown } }
        cloudflare?: { env?: unknown }
      }
    | undefined
  const fromEvent = ctx?.cloudflare?.env ?? ctx?._platform?.cloudflare?.env
  if (fromEvent != null) return fromEvent
  // Nested Nitro SSR fetches omit `event.context.cloudflare` (narduk-libs#49).
  // The request plugin stores the outer env; read it here so useDatabase and
  // KV/Hyperdrive helpers keep working even if a hook ran out of order.
  return readStoredCloudflareContext()?.env
}

function readNodeRuntimeEnv(): WorkerRuntimeEnv {
  const processEnv = Reflect.get(globalThis, 'process') as { env?: WorkerRuntimeEnv } | undefined
  const env = processEnv?.env
  if (env != null) return env
  return {}
}

/**
 * Deployed Cloudflare Workers expose request-scoped bindings on
 * `event.context.cloudflare.env` (populated by the Nitro cloudflare-module
 * preset). We deliberately avoid a top-level
 * `import { env } from 'cloudflare:workers'` because Nuxt's Nitro prerenderer
 * runs compiled modules under Node's default ESM loader, which rejects the
 * `cloudflare:` URL scheme and crashes the build.
 */
export function readWorkerRuntimeEnv(
  event?: H3Event,
  nodeEnv: WorkerRuntimeEnv = readNodeRuntimeEnv(),
): WorkerRuntimeEnv {
  const runtimeEnv = event === undefined ? undefined : getCloudflareEnvFromEvent(event)
  const contextEnv = copyWorkerBindings(runtimeEnv)

  return {
    ...nodeEnv,
    ...contextEnv,
  }
}

export function readCloudflareRuntimeEnv(event: H3Event): WorkerRuntimeEnv {
  return copyWorkerBindings(getCloudflareEnvFromEvent(event))
}
