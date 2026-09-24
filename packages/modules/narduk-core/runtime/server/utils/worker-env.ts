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
  return readIsolateWorkerEnv()
}

/**
 * The Worker `env` Nitro's cloudflare presets stamp on `globalThis.__env__`
 * before every fetch, scheduled, queue and email handler runs (and the
 * `nitro-cloudflare-dev` proxy stamps in `nuxt dev`).
 *
 * A relative `useFetch` / `$fetch` during SSR goes through Nitro's
 * `localFetch`, which builds a new H3 event without the outer request's
 * `_platform.cloudflare`, so the nested handler has no `event.context.cloudflare`
 * and `useDatabase` 500s even though the Worker still has `DB`
 * (narduk-libs#49). Bindings are identical for every request an isolate
 * serves, so the isolate env is the same object the outer event carried.
 *
 * Deliberately not AsyncLocalStorage: workerd does not implement
 * `AsyncLocalStorage.enterWith()`, which a request-hook propagation would
 * need. When neither the event nor the isolate has an env (Node, tests,
 * prerender), this returns `undefined` and callers fail closed as before.
 */
function readIsolateWorkerEnv(): unknown {
  const env: unknown = Reflect.get(globalThis, '__env__')
  return env != null && typeof env === 'object' ? env : undefined
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
 * preset). An event without it — a nested SSR fetch — falls back to the
 * isolate's `globalThis.__env__` (narduk-libs#49). We deliberately avoid a top-level
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
