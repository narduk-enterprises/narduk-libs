/**
 * MapKit JS v6 initialization through Apple's own `@apple/mapkit-loader`.
 *
 * The contract here is narduk-libs#421 §d, which is normative and corrects the
 * 2.0.x shape in three ways:
 *
 * 1. `load()` is called **without** `token`. A token there lands in
 *    `data-token` on the injected script and wires MapKit's static,
 *    non-refreshable path.
 * 2. `libraries` is mandatory in v6, so it is a required option here.
 * 3. MapKit never re-asks for a token after a failed exchange. Measured on
 *    2026-09-17: on a rejected token it retried `/ma/bootstrap` three times with
 *    the SAME token, invoked `authorizationCallback` exactly once, and gave up.
 *    So the `error` handler clears the singleton, and recovery belongs to the
 *    caller (`<AppMapKit>`'s `retry()`).
 */
import type { MapKit } from '@apple/mapkit-loader'

/**
 * A MapKit JS v6 library name -- `'map'`, `'annotations'`, `'overlays'`, and
 * whatever else Apple ships. Apple types `mapkit.Libraries` as `string[]` and
 * publishes no union, so this deliberately does not invent one.
 */
export type MapKitLibrary = string

/**
 * Apple's `ConfigurationErrorStatus`, verbatim (§c.7). Apple's own `.d.ts` does
 * not export the type, so it is restated here and pinned to
 * `MapKitConfigurationErrorEvent['status']` by a compile-time conformance check
 * in `tests/loader.test.ts`.
 */
export type MapKitErrorStatus =
  | 'Bad Request'
  | 'Malformed Response'
  | 'Network Error'
  | 'Timeout'
  | 'Too Many Requests'
  | 'Unauthorized'
  | 'Unknown'

/** Apple's `ConfigurationChangeStatus`, verbatim. */
export type MapKitConfigurationChangeStatus = 'Initialized' | 'Refreshed'

export interface MapKitFailure {
  /** Present for `source: 'token'`. */
  httpStatus?: number
  message: string
  /** Parsed from Apple's `Origin does not match - expected: X, actual: Y` suffix. */
  originMismatch?: { actual: string; expected: string }
  source: 'mapkit' | 'token'
  status: MapKitErrorStatus
}

/** Thrown by `initializeMapKit()`; carries the `MapKitFailure` §c.7 renders. */
export class MapKitAuthError extends Error implements MapKitFailure {
  readonly httpStatus?: number
  readonly originMismatch?: { actual: string; expected: string }
  readonly source: 'mapkit' | 'token'
  readonly status: MapKitErrorStatus

  constructor(failure: MapKitFailure) {
    super(failure.message)
    this.name = 'MapKitAuthError'
    this.source = failure.source
    this.status = failure.status
    if (failure.httpStatus !== undefined) this.httpStatus = failure.httpStatus
    if (failure.originMismatch !== undefined) this.originMismatch = failure.originMismatch
  }

  /** The plain `MapKitFailure` a caller renders through `#error`. */
  get failure(): MapKitFailure {
    return {
      message: this.message,
      source: this.source,
      status: this.status,
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
      ...(this.originMismatch === undefined ? {} : { originMismatch: this.originMismatch }),
    }
  }
}

/** The body the token route returns on success (§e.2). */
export interface MapKitTokenEndpointResponse {
  error?: string
  expiresAt?: number
  token?: string
}

/** `@apple/mapkit-loader`'s `load`, narrowed to what this module passes it. */
export type MapKitLoadFunction = (options: {
  language?: string
  libraries?: string[]
  nonce?: string
  version?: string
}) => Promise<MapKit>

export interface MapKitClientOptions {
  /** Injected under test. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  language?: string
  /** Mandatory in v6: `mapkit.core.js` is a stub without them. */
  libraries: readonly MapKitLibrary[]
  /** Injected under test. Defaults to `@apple/mapkit-loader`'s `load`. */
  loadImpl?: MapKitLoadFunction
  /** CSP nonce for the injected `<script>`. */
  nonce?: string
  /** Fires for `'Initialized'` and for every later `'Refreshed'`. */
  onConfigurationChange?: (status: MapKitConfigurationChangeStatus) => void
  /** Fires for every MapKit `error`, including ones after a successful init. */
  onFailure?: (failure: MapKitFailure) => void
  /** Relative path only, enforced (§b.1); the fetch must stay same-origin. */
  tokenEndpoint?: string
  /** Defaults to `'6'`. The loader throws on any `5*`. */
  version?: string
}

const DEFAULT_TOKEN_ENDPOINT = '/api/mapkit-token'
const DEFAULT_VERSION = '6'
const ORIGIN_MISMATCH =
  /Origin does not match - expected:\s*(?<expected>\S+),\s*actual:\s*(?<actual>\S+)/

let initPromise: Promise<MapKit> | null = null
let initPromiseKey = ''
let objectIdCounter = 0
const objectIds = new WeakMap<object, number>()

function optionIdentity(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'object' && typeof value !== 'function') return String(value)
  const objectValue = value as object
  let id = objectIds.get(objectValue)
  if (!id) {
    id = ++objectIdCounter
    objectIds.set(objectValue, id)
  }
  return `#${id}`
}

function mapKitInitCacheKey(options: MapKitClientOptions): string {
  return [
    [...options.libraries].join(','),
    options.language ?? '',
    options.nonce ?? '',
    options.version ?? DEFAULT_VERSION,
    options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
    optionIdentity(options.fetchImpl),
    optionIdentity(options.loadImpl),
  ].join('|')
}

/** Apple's diagnostic is the single most useful string for a bad preview host. */
export function parseMapKitOriginMismatch(
  message: string,
): { actual: string; expected: string } | undefined {
  const match = ORIGIN_MISMATCH.exec(message)
  if (!match?.groups) return undefined
  const { actual, expected } = match.groups
  if (!actual || !expected) return undefined
  return { actual, expected }
}

/** Token-route refusals map onto Apple's own names rather than a parallel enum (§c.7). */
export function mapKitErrorStatusForHttpStatus(httpStatus: number): MapKitErrorStatus {
  if (httpStatus === 403 || httpStatus === 503) return 'Unauthorized'
  if (httpStatus === 429) return 'Too Many Requests'
  if (httpStatus === 400 || httpStatus === 405) return 'Bad Request'
  if (httpStatus === 408 || httpStatus === 504) return 'Timeout'
  return 'Unknown'
}

/** An absolute (`https://host/p`) or protocol-relative (`//host/p`) endpoint. */
const CROSS_ORIGIN_CAPABLE_ENDPOINT = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

/**
 * §b.1: the token endpoint is "relative path only; an absolute URL is a config
 * error". Enforced rather than commented -- an absolute endpoint is a
 * cross-origin fetch for a token Apple would refuse on this page anyway, and
 * failing at configuration time says so far more clearly than a CORS error.
 */
function assertRelativeTokenEndpoint(endpoint: string): void {
  // WHATWG treats `\` as `/` in a relative URL, so `/\host/p` is protocol-relative.
  const canonical = endpoint.trim().replaceAll('\\', '/')
  if (!CROSS_ORIGIN_CAPABLE_ENDPOINT.test(canonical)) return
  throw new Error(
    `tokenEndpoint must be a relative path on the serving origin, not ${endpoint}: ` +
      'the MapKit token route is same-host by design (narduk-libs#421 §b.1)',
  )
}

/**
 * Fetch one token from the same-origin route.
 *
 * The endpoint is relative on purpose, so the request always goes to the origin
 * that served the page -- the origin Apple will enforce in the `origin` claim.
 * The token is never persisted, never logged, and never put in a URL.
 */
export async function fetchMapKitToken(
  endpoint: string = DEFAULT_TOKEN_ENDPOINT,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  assertRelativeTokenEndpoint(endpoint)

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    throw new MapKitAuthError({
      message: error instanceof Error ? error.message : 'Failed to fetch a MapKit token',
      source: 'token',
      status: 'Network Error',
    })
  }

  let body: MapKitTokenEndpointResponse
  try {
    body = (await response.json()) as MapKitTokenEndpointResponse
  } catch {
    throw new MapKitAuthError({
      httpStatus: response.status,
      message: 'The MapKit token route returned a body that is not JSON.',
      source: 'token',
      status: 'Malformed Response',
    })
  }

  if (!response.ok) {
    throw new MapKitAuthError({
      httpStatus: response.status,
      message: body.error ?? `The MapKit token route answered ${String(response.status)}.`,
      source: 'token',
      status: mapKitErrorStatusForHttpStatus(response.status),
    })
  }

  if (typeof body.token !== 'string' || !body.token) {
    throw new MapKitAuthError({
      httpStatus: response.status,
      message: 'The MapKit token route answered 200 with no token.',
      source: 'token',
      status: 'Malformed Response',
    })
  }

  return body.token
}

async function resolveLoad(options: MapKitClientOptions): Promise<MapKitLoadFunction> {
  if (options.loadImpl) return options.loadImpl
  const loader = await import('@apple/mapkit-loader')
  return loader.load
}

function failureFromErrorEvent(event: { message?: string; status?: string }): MapKitFailure {
  const message = event.message ?? 'MapKit JS failed to initialize.'
  const originMismatch = parseMapKitOriginMismatch(message)
  return {
    message,
    source: 'mapkit',
    // Apple owns this enum; an unrecognized value is reported as Apple's own
    // catch-all rather than silently dropped.
    status: (event.status as MapKitErrorStatus | undefined) ?? 'Unknown',
    ...(originMismatch === undefined ? {} : { originMismatch }),
  }
}

/**
 * Load MapKit JS v6 and complete one token exchange.
 *
 * Singleton: four call sites share one initialization. A failure clears the
 * singleton so a caller can retry -- MapKit itself never will.
 */
export async function initializeMapKit(options: MapKitClientOptions): Promise<MapKit> {
  if (options.libraries.length === 0) {
    throw new Error('libraries is required: MapKit JS 6 loads no map library by default')
  }
  // Before `load()`, not at the first token exchange: a misconfigured endpoint
  // should not cost a script injection and a MapKit init that can only hang.
  assertRelativeTokenEndpoint(options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT)

  const cacheKey = mapKitInitCacheKey(options)
  if (initPromise && initPromiseKey !== cacheKey) {
    throw new Error('MapKit is already initialized or initializing with different options')
  }

  initPromiseKey = cacheKey
  initPromise ??= (async () => {
    const load = await resolveLoad(options)
    const loadOptions: Parameters<MapKitLoadFunction>[0] = {
      libraries: [...options.libraries],
      version: options.version ?? DEFAULT_VERSION,
    }
    if (options.language !== undefined) loadOptions.language = options.language
    if (options.nonce !== undefined) loadOptions.nonce = options.nonce

    // NO `token` here: that is MapKit's static, non-refreshable path (§d.1).
    const mapkit = await load(loadOptions)

    return await new Promise<MapKit>((resolve, reject) => {
      let settled = false

      mapkit.addEventListener('configuration-change', ((event: { status?: string }) => {
        const status = (event.status ?? 'Initialized') as MapKitConfigurationChangeStatus
        options.onConfigurationChange?.(status)
        if (status !== 'Initialized' || settled) return
        settled = true
        resolve(mapkit)
      }) as EventListener)

      mapkit.addEventListener('error', ((event: { message?: string; status?: string }) => {
        // MapKit never re-asks for a token, so the singleton is cleared on EVERY
        // error -- including one that arrives long after init resolved, which is
        // what makes `retry()` possible (§d.4).
        initPromise = null
        initPromiseKey = ''
        const failure = failureFromErrorEvent(event)
        options.onFailure?.(failure)
        if (settled) return
        settled = true
        reject(new MapKitAuthError(failure))
      }) as EventListener)

      mapkit.init({
        ...(options.language === undefined ? {} : { language: options.language }),
        authorizationCallback: (done) => {
          void (async () => {
            try {
              done(await fetchMapKitToken(options.tokenEndpoint, options.fetchImpl))
            } catch (error) {
              // Never `done('')`: an empty token is a second bootstrap attempt
              // that fails with a less useful status than the real cause.
              initPromise = null
              initPromiseKey = ''
              const failure =
                error instanceof MapKitAuthError
                  ? error.failure
                  : {
                      message: error instanceof Error ? error.message : String(error),
                      source: 'token' as const,
                      status: 'Unknown' as const,
                    }
              options.onFailure?.(failure)
              if (settled) return
              settled = true
              reject(error instanceof MapKitAuthError ? error : new MapKitAuthError(failure))
            }
          })()
        },
      })
    })
  })().catch((error: unknown) => {
    initPromise = null
    initPromiseKey = ''
    throw error
  })

  return initPromise
}

export function resetMapKitClientStateForTests(): void {
  initPromise = null
  initPromiseKey = ''
}
