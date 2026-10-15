/**
 * A missing build asset must never be cached (operator-portal#2534).
 *
 * Nitro's `cloudflare_module` entry answers a public-asset URL with
 * `env.ASSETS.fetch(request)`. When a deploy has removed a hashed
 * `/_nuxt/*.js` chunk, the assets layer answers 404 and still stamps it with
 * the `_headers` rule Nitro wrote for `/_nuxt/*`,
 * `cache-control: public, max-age=31536000, immutable`. Safari keeps that 404
 * for a year, so a tab open across a deploy reloads (see `chunk-reload.ts`)
 * into the same cached miss forever.
 *
 * `withUncachedAssetMiss` wraps the `ASSETS` binding so a 404 leaves with
 * `cache-control: no-store`; every other status is returned untouched. The
 * entry in `runtime/nitro/cloudflare-module.ts` hands the preset's own handler
 * the wrapped binding. Nothing here touches Nitro, so it is unit-testable.
 *
 * Opt out with `appConfig.narduk.assetMissNoStore = false`.
 */

/** The slice of Cloudflare's `ASSETS` binding the Nitro entry uses. */
export interface AssetsBindingLike {
  fetch(request: Request, init?: RequestInit): Promise<Response> | Response
}

/** The handler object Nitro's `createHandler` returns. */
export interface WorkerHandlerLike {
  fetch?: unknown
}

type EnvLike = Record<string | symbol, unknown>

const assetsProxies = new WeakMap<object, AssetsBindingLike>()
const envProxies = new WeakMap<object, EnvLike>()

/** Reads `appConfig.narduk.assetMissNoStore`; only an explicit `false` opts out. */
export function isAssetMissNoStoreEnabled(appConfig: unknown): boolean {
  if (appConfig === null || typeof appConfig !== 'object') return true
  const narduk = (appConfig as { narduk?: unknown }).narduk
  if (narduk === null || typeof narduk !== 'object') return true
  return (narduk as { assetMissNoStore?: unknown }).assetMissNoStore !== false
}

/** A copy of an asset 404 whose cache posture is `no-store`. */
async function uncachedMiss(response: Response): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

/** The `ASSETS` binding, with a 404 answered `no-store`. Other statuses pass through as the same object. */
export function withUncachedAssetMiss(assets: AssetsBindingLike): AssetsBindingLike {
  const known = assetsProxies.get(assets)
  if (known) return known
  const wrapped = new Proxy(assets, {
    get(target, property) {
      if (property === 'fetch') {
        return async (...args: Parameters<AssetsBindingLike['fetch']>) => {
          const response = await target.fetch(...args)
          return response.status === 404 ? uncachedMiss(response) : response
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  assetsProxies.set(assets, wrapped)
  return wrapped
}

/** The Worker `env`, with `ASSETS` swapped for the wrapped binding. Without `ASSETS`, `env` itself. */
export function withUncachedAssetMissEnv<Env>(env: Env): Env {
  if (env === null || typeof env !== 'object') return env
  const assets = (env as { ASSETS?: unknown }).ASSETS
  if (assets === null || typeof assets !== 'object') return env
  if (typeof (assets as { fetch?: unknown }).fetch !== 'function') return env
  const known = envProxies.get(env)
  if (known) return known as Env
  const wrapped = new Proxy(env as unknown as EnvLike, {
    get(target, property) {
      if (property === 'ASSETS') return withUncachedAssetMiss(assets as AssetsBindingLike)
      return Reflect.get(target, property, target) as unknown
    },
  })
  envProxies.set(env, wrapped)
  return wrapped as Env
}

/**
 * Nitro's cloudflare-module handler (`{ fetch, scheduled, email, queue, ... }`)
 * with its `fetch` handed the wrapped `env`. Disabled, the handler is returned
 * as it came. The other Worker handlers never read `ASSETS`, so they keep the
 * original `env`.
 */
export function withUncachedAssetMissHandler<Handler extends WorkerHandlerLike>(
  handler: Handler,
  enabled: boolean,
): Handler {
  if (!enabled || typeof handler.fetch !== 'function') return handler
  const originalFetch = handler.fetch as (...args: unknown[]) => unknown
  return {
    ...handler,
    fetch: (request: Request, env: unknown, ...rest: unknown[]) =>
      originalFetch.call(handler, request, withUncachedAssetMissEnv(env), ...rest),
  } as unknown as Handler
}
