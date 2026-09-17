/**
 * Server-side client for published `narduk-data` products.
 *
 * Every Narduk app that reads a narduk-data product performs the same three
 * steps: fetch `<origin>/<product>/current/manifest.json`, fetch the immutable
 * artifact the manifest names, and check that artifact against the manifest's
 * SHA-256 before trusting a byte of it. Apps were re-deriving that dance — and
 * the timeout, retry, coalescing and freshness policy around it — one server
 * util at a time.
 *
 * Two layers live here, and nothing else is exported:
 *
 * - `fetchNardukDataJson` — one typed request: per-attempt timeout, a bounded
 *   retry that only ever applies to an idempotent `GET`/`HEAD`, a hard body-size
 *   ceiling, request-id propagation, and a caller-supplied response schema.
 * - `createNardukDataClient` — the product read built on top of it: manifest,
 *   artifact, checksum, a short isolate-local memo, single-flight coalescing,
 *   an opt-in stale-if-error window, and freshness metadata.
 *
 * Truth is preserved rather than flattened. A value served from the stale path
 * says so; a manifest that states no publish time yields `state: 'unknown'`
 * rather than `'fresh'`; the producer's own staleness word is republished
 * verbatim beside the derived verdict instead of being mapped onto it; and a
 * schema failure, a checksum mismatch and an upstream outage stay distinct
 * error reasons rather than collapsing into an empty result.
 *
 * Cloudflare Workers constraints: no Node-only APIs, no module-level cache (the
 * caller owns a client instance, whose cache is bounded by entry count), and no
 * timer this module has to clear — cancellation rides on `AbortSignal`.
 */

/** Origin every published narduk-data product is served from. */
export const NARDUK_DATA_ORIGIN = 'https://data.nard.uk'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 1
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024
const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_ENTRIES = 8
const REQUEST_ID_HEADER = 'x-request-id'

/**
 * Why a narduk-data read failed.
 *
 * - `aborted` — the caller's own signal cancelled the request.
 * - `checksum` — the artifact does not match its immutable manifest.
 * - `http` — the upstream answered a non-2xx status (see `status`).
 * - `network` — the request never produced a response.
 * - `schema` — the body was not JSON, or did not satisfy the supplied schema.
 * - `timeout` — an attempt ran past its timeout.
 * - `too-large` — the body exceeded the caller's byte ceiling.
 */
export type NardukDataErrorReason =
  'aborted' | 'checksum' | 'http' | 'network' | 'schema' | 'timeout' | 'too-large'

/** Every failure this module raises, so callers can branch on `reason`. */
export class NardukDataError extends Error {
  /** Which failure this is. */
  readonly reason: NardukDataErrorReason
  /** HTTP status for `reason: 'http'`; `null` for every other reason. */
  readonly status: number | null
  /** The URL that failed. */
  readonly url: string

  constructor(
    message: string,
    reason: NardukDataErrorReason,
    url: string,
    status: number | null = null,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'NardukDataError'
    this.reason = reason
    this.status = status
    this.url = url
  }
}

/**
 * A response validator.
 *
 * Structurally a zod schema — zod v4's `safeParse` satisfies it as written — so
 * a caller's existing schemas plug in without this module depending on a
 * validator library or pinning its version for every consumer.
 */
export interface NardukDataSchema<T> {
  safeParse: (value: unknown) => { data: T; success: true } | { error?: unknown; success: false }
}

/**
 * Per-request correlation and cancellation.
 *
 * `requestId` is sent as `x-request-id`; a request-id middleware supplies it
 * from the incoming request rather than this module generating one. Note that
 * single-flight coalescing means only the caller whose read actually reached
 * the network contributes its id — callers joined onto that read are answered
 * by a request carrying the first caller's id.
 */
export interface NardukDataRequestContext {
  /** Extra request headers; `accept` and `x-request-id` are set for you. */
  headers?: Readonly<Record<string, string>>
  /** Correlation id propagated upstream as `x-request-id`. */
  requestId?: string
  /** Caller cancellation, combined with the per-attempt timeout. */
  signal?: AbortSignal
}

/** Transport policy shared by every request this module makes. */
interface NardukDataRequestPolicy {
  /** Request body. Supplying one implies a non-idempotent method, so no retry. */
  body?: BodyInit
  /** Correlation, extra headers and caller cancellation. */
  context?: NardukDataRequestContext
  /** Fetch implementation; defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Hard ceiling on the response body. Defaults to 16 MiB. */
  maxBytes?: number
  /** Extra attempts after the first, for an idempotent method. Defaults to 1. */
  retries?: number
  /** Timeout for each attempt, in milliseconds. Defaults to 15000. */
  timeoutMs?: number
  /** `user-agent` to send; omitted when unset. */
  userAgent?: string
}

/** Options for one typed narduk-data request. */
export interface NardukDataFetchOptions<T> extends NardukDataRequestPolicy {
  /** HTTP method. Defaults to `GET`; anything but `GET`/`HEAD` is never retried. */
  method?: string
  /** Validator the decoded body must satisfy. */
  schema: NardukDataSchema<T>
}

/**
 * The manifest fields this client depends on.
 *
 * A product may publish (and validate) far more; a caller-supplied
 * `manifestSchema` only has to produce at least this much.
 */
export interface NardukDataReleaseManifest {
  artifact: { path: string; sha256: string }
  releaseId: string
  staleness?: {
    age_minutes?: number | null
    newest_as_of?: string | null
    state?: string | null
  } | null
}

/** Derived freshness verdict. `unknown` is never quietly promoted to `fresh`. */
export type NardukDataFreshnessState = 'aging' | 'fresh' | 'stale' | 'unknown'

/**
 * When published data stops counting as current.
 *
 * Only the consumer knows a product's publish cadence, so there is no default:
 * a product that declares no thresholds reports `state: 'unknown'` rather than
 * inventing a verdict.
 */
export interface NardukDataFreshnessThresholds {
  /** Age past which the state is `aging`, in milliseconds. */
  agingAfterMs: number
  /** Age past which the state is `stale`, in milliseconds. */
  staleAfterMs: number
}

/** Where a served value came from. */
export type NardukDataSource = 'memo' | 'stale-if-error' | 'upstream'

/** Freshness metadata published beside every value this client returns. */
export interface NardukDataFreshness {
  /** Milliseconds since `fetchedAt`, by this isolate's clock. */
  ageMs: number
  /** When the served value was read from upstream. */
  fetchedAt: string
  /** Age of `publishedAt`; `null` when the manifest states no publish time. */
  publishedAgeMs: number | null
  /** The producer's publish instant; `null` when the manifest states none. */
  publishedAt: string | null
  /** The producer's own staleness word, verbatim and unmapped; `null` when absent. */
  publishedState: string | null
  /** Release the served value belongs to. */
  releaseId: string
  /** Where this value came from. */
  source: NardukDataSource
  /** True only when the value was served by the stale-if-error path. */
  stale: boolean
  /** Verdict derived from `publishedAgeMs` and the product's thresholds. */
  state: NardukDataFreshnessState
}

/** One published product a client can read. */
export interface NardukDataProduct<
  TArtifact,
  TManifest extends NardukDataReleaseManifest = NardukDataReleaseManifest,
> {
  /** Artifact file name inside the release, e.g. `public-buoy-data.json`. */
  artifactPath: string
  /** Thresholds for the derived state. Omitted, the state is `unknown`. */
  freshness?: NardukDataFreshnessThresholds
  /** Stricter manifest validator; defaults to the shared release contract. */
  manifestSchema?: NardukDataSchema<TManifest>
  /** Hard ceiling on each body read for this product. Defaults to 16 MiB. */
  maxBytes?: number
  /**
   * How long a last-good value may be served after an upstream failure.
   * Defaults to 0 — fail closed, exactly as a hand-rolled read does today.
   */
  maxStaleMs?: number
  /** Product family id, e.g. `buoy-status-v1`. */
  productId: string
  /** Validator the artifact must satisfy. */
  schema: NardukDataSchema<TArtifact>
  /** How long a value is served without re-reading upstream. Defaults to 60000. */
  ttlMs?: number
}

/** A product read: the artifact, its manifest, and how fresh the pair is. */
export interface NardukDataResult<TArtifact, TManifest> {
  data: TArtifact
  freshness: NardukDataFreshness
  manifest: TManifest
}

/** Options shared by every product one client reads. */
export interface NardukDataClientOptions {
  /** Fetch implementation; defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Products held at once. Defaults to 8; the least recently used is evicted. */
  maxEntries?: number
  /** Epoch-millisecond clock, injected by tests. Defaults to `Date.now`. */
  now?: () => number
  /** Origin to read from. Defaults to `https://data.nard.uk`. */
  origin?: string
  /** Extra attempts after the first. Defaults to 1. */
  retries?: number
  /** Timeout for each attempt, in milliseconds. Defaults to 15000. */
  timeoutMs?: number
  /** `user-agent` to send; omitted when unset. */
  userAgent?: string
}

/** A narduk-data reader bound to one origin, holding one bounded cache. */
export interface NardukDataClient {
  read: <TArtifact, TManifest extends NardukDataReleaseManifest>(
    product: NardukDataProduct<TArtifact, TManifest>,
    context?: NardukDataRequestContext,
  ) => Promise<NardukDataResult<TArtifact, TManifest>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The manifest contract this client depends on, and nothing more.
 *
 * A product that wants its whole manifest validated passes its own schema; this
 * one exists so the common case needs no schema at all and still refuses a
 * response that cannot address an immutable artifact.
 */
const releaseManifestSchema: NardukDataSchema<NardukDataReleaseManifest> = {
  safeParse(value) {
    if (
      !isRecord(value) ||
      typeof value.releaseId !== 'string' ||
      value.releaseId.length === 0 ||
      !isRecord(value.artifact) ||
      typeof value.artifact.path !== 'string' ||
      typeof value.artifact.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/iu.test(value.artifact.sha256)
    ) {
      return { error: 'not a narduk-data release manifest', success: false }
    }
    return { data: value as unknown as NardukDataReleaseManifest, success: true }
  },
}

/**
 * Abort and timeout both surface as a `DOMException`, whose relationship to
 * `Error` differs between runtimes, so this reads the name rather than the
 * prototype chain.
 */
function isAbortError(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.name === 'AbortError' || error.name === 'TimeoutError'
}

function combineSignals(timeout: AbortSignal, caller?: AbortSignal): AbortSignal {
  if (!caller) return timeout
  if (caller.aborted) return caller
  return AbortSignal.any([timeout, caller])
}

function requestHeaders(policy: NardukDataRequestPolicy): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  for (const [name, value] of Object.entries(policy.context?.headers ?? {})) {
    headers[name.toLowerCase()] = value
  }
  if (policy.context?.requestId) headers[REQUEST_ID_HEADER] = policy.context.requestId
  if (policy.userAgent) headers['user-agent'] = policy.userAgent
  return headers
}

function tooLargeError(url: string, maxBytes: number): NardukDataError {
  return new NardukDataError(
    `narduk-data response from ${url} exceeds the ${maxBytes}-byte consumer ceiling.`,
    'too-large',
    url,
  )
}

/**
 * Read a body while holding `maxBytes` as a hard ceiling.
 *
 * The ceiling is enforced against bytes actually accumulated, so an upstream
 * that omits or lies about `content-length` cannot push more than one chunk
 * past it into isolate memory; the stream is cancelled rather than drained.
 */
async function readBoundedBody(
  response: Response,
  url: string,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw tooLargeError(url, maxBytes)
  }

  const body = response.body
  if (!body) {
    const buffered = new Uint8Array(await response.arrayBuffer())
    if (buffered.byteLength > maxBytes) throw tooLargeError(url, maxBytes)
    return buffered
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let byteCount = 0
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- a stream is read one chunk at a time; that is the point of the ceiling
      const { done, value } = await reader.read()
      if (done) break
      byteCount += value.byteLength
      if (byteCount > maxBytes) {
        // eslint-disable-next-line no-await-in-loop -- cancelling stops the download instead of draining the rest of it
        await reader.cancel()
        throw tooLargeError(url, maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(byteCount)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

async function attemptRequest(
  url: string,
  policy: NardukDataRequestPolicy,
  method: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const timeoutSignal = AbortSignal.timeout(policy.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const fetcher = policy.fetch ?? fetch
  try {
    const response = await fetcher(url, {
      body: policy.body,
      headers: requestHeaders(policy),
      method,
      signal: combineSignals(timeoutSignal, policy.context?.signal),
    })
    if (!response.ok) {
      throw new NardukDataError(
        `narduk-data request to ${url} answered HTTP ${response.status}.`,
        'http',
        url,
        response.status,
      )
    }
    return await readBoundedBody(response, url, policy.maxBytes ?? DEFAULT_MAX_BYTES)
  } catch (error) {
    if (error instanceof NardukDataError) throw error
    if (isAbortError(error)) {
      throw timeoutSignal.aborted
        ? new NardukDataError(
            `narduk-data request to ${url} timed out.`,
            'timeout',
            url,
            null,
            error,
          )
        : new NardukDataError(
            `narduk-data request to ${url} was cancelled by the caller.`,
            'aborted',
            url,
            null,
            error,
          )
    }
    throw new NardukDataError(
      `narduk-data request to ${url} failed before a response arrived.`,
      'network',
      url,
      null,
      error,
    )
  }
}

/** Only a transport-level failure is worth repeating; a 4xx or a bad body is not. */
function isRetryableFailure(error: NardukDataError): boolean {
  if (error.reason === 'network' || error.reason === 'timeout') return true
  return error.reason === 'http' && error.status !== null && error.status >= 500
}

/**
 * Run a request, retrying only what is safe to repeat.
 *
 * The retry budget applies to `GET` and `HEAD` alone: a method that may have
 * changed state upstream is attempted exactly once, whatever it returns. Each
 * attempt gets its own timeout, so the worst case is `retries + 1` timeouts;
 * there is no backoff sleep, and so no timer to leave behind.
 */
async function requestBytes(
  url: string,
  policy: NardukDataRequestPolicy,
  method: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const idempotent = method === 'GET' || method === 'HEAD'
  const attempts = idempotent ? Math.max(0, policy.retries ?? DEFAULT_RETRIES) + 1 : 1
  let attempt = 0
  for (;;) {
    attempt += 1
    try {
      // eslint-disable-next-line no-await-in-loop -- a retry is by definition sequential; running the attempts together would be the bug
      return await attemptRequest(url, policy, method)
    } catch (error) {
      const failure =
        error instanceof NardukDataError
          ? error
          : new NardukDataError(
              `narduk-data request to ${url} failed.`,
              'network',
              url,
              null,
              error,
            )
      if (attempt >= attempts || !isRetryableFailure(failure)) throw failure
    }
  }
}

function decodeJson(url: string, bytes: Uint8Array<ArrayBuffer>): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new NardukDataError(
      `narduk-data response from ${url} is not valid JSON.`,
      'schema',
      url,
      null,
      error,
    )
  }
}

function applySchema<T>(url: string, value: unknown, schema: NardukDataSchema<T>): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new NardukDataError(
      `narduk-data response from ${url} does not satisfy its schema.`,
      'schema',
      url,
      null,
      parsed.error,
    )
  }
  return parsed.data
}

/**
 * One typed narduk-data request.
 *
 * The primitive under `createNardukDataClient`, exported for the reads that are
 * not a product artifact — a manifest on its own, a catalogue index, a pinned
 * release. It deliberately does not cache or coalesce: that belongs to the
 * client, which has a key to cache under.
 */
export async function fetchNardukDataJson<T>(
  url: string,
  options: NardukDataFetchOptions<T>,
): Promise<T> {
  const bytes = await requestBytes(url, options, options.method ?? 'GET')
  return applySchema(url, decodeJson(url, bytes), options.schema)
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function freshnessState(
  publishedAgeMs: number | null,
  thresholds?: NardukDataFreshnessThresholds,
): NardukDataFreshnessState {
  if (publishedAgeMs === null || !thresholds) return 'unknown'
  if (publishedAgeMs > thresholds.staleAfterMs) return 'stale'
  if (publishedAgeMs > thresholds.agingAfterMs) return 'aging'
  return 'fresh'
}

function publishedInstant(manifest: NardukDataReleaseManifest): string | null {
  const at = manifest.staleness?.newest_as_of
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : null
}

function describeFreshness(
  manifest: NardukDataReleaseManifest,
  fetchedAtMs: number,
  now: number,
  source: NardukDataSource,
  thresholds?: NardukDataFreshnessThresholds,
): NardukDataFreshness {
  const publishedAt = publishedInstant(manifest)
  const publishedAgeMs = publishedAt === null ? null : now - Date.parse(publishedAt)
  const publishedState = manifest.staleness?.state
  return {
    ageMs: now - fetchedAtMs,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    publishedAgeMs,
    publishedAt,
    publishedState: typeof publishedState === 'string' ? publishedState : null,
    releaseId: manifest.releaseId,
    source,
    stale: source === 'stale-if-error',
    state: freshnessState(publishedAgeMs, thresholds),
  }
}

interface CacheEntry {
  data: unknown
  fetchedAtMs: number
  manifest: NardukDataReleaseManifest
}

function joinUrl(origin: string, ...segments: string[]): string {
  return [origin.replace(/\/+$/u, ''), ...segments].join('/')
}

/**
 * Create a narduk-data reader.
 *
 * One client per isolate is the intended shape: an app holds it at module scope
 * in its own server util so concurrent handlers share the memo and the
 * single-flight map. The cache lives on the instance and is bounded by
 * `maxEntries`, so even a module-scoped client cannot grow without limit.
 */
export function createNardukDataClient(options: NardukDataClientOptions = {}): NardukDataClient {
  const origin = options.origin ?? NARDUK_DATA_ORIGIN
  const now = options.now ?? (() => Date.now())
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<CacheEntry>>()

  function remember(key: string, entry: CacheEntry): void {
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      cache.delete(oldest.value)
    }
  }

  function recall(key: string): CacheEntry | undefined {
    const entry = cache.get(key)
    if (!entry) return undefined
    cache.delete(key)
    cache.set(key, entry)
    return entry
  }

  async function load<TArtifact, TManifest extends NardukDataReleaseManifest>(
    product: NardukDataProduct<TArtifact, TManifest>,
    context: NardukDataRequestContext | undefined,
  ): Promise<CacheEntry> {
    const policy: NardukDataRequestPolicy = {
      context,
      fetch: options.fetch,
      maxBytes: product.maxBytes ?? DEFAULT_MAX_BYTES,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent,
    }
    const productSegment = encodeURIComponent(product.productId)
    const manifestUrl = joinUrl(origin, productSegment, 'current', 'manifest.json')
    const manifest = await fetchNardukDataJson(manifestUrl, {
      ...policy,
      schema: product.manifestSchema ?? (releaseManifestSchema as NardukDataSchema<TManifest>),
    })

    const artifactUrl = joinUrl(
      origin,
      productSegment,
      'releases',
      encodeURIComponent(manifest.releaseId),
      product.artifactPath.replace(/^\/+/u, ''),
    )
    const bytes = await requestBytes(artifactUrl, policy, 'GET')
    const observed = await sha256Hex(bytes)
    if (observed !== manifest.artifact.sha256.toLowerCase()) {
      throw new NardukDataError(
        `narduk-data artifact ${artifactUrl} does not match the SHA-256 in its immutable manifest.`,
        'checksum',
        artifactUrl,
      )
    }

    return {
      data: applySchema(artifactUrl, decodeJson(artifactUrl, bytes), product.schema),
      fetchedAtMs: now(),
      manifest,
    }
  }

  return {
    async read<TArtifact, TManifest extends NardukDataReleaseManifest>(
      product: NardukDataProduct<TArtifact, TManifest>,
      context?: NardukDataRequestContext,
    ): Promise<NardukDataResult<TArtifact, TManifest>> {
      const key = `${product.productId}/${product.artifactPath}`
      const present = (entry: CacheEntry, source: NardukDataSource) => ({
        data: entry.data as TArtifact,
        freshness: describeFreshness(
          entry.manifest,
          entry.fetchedAtMs,
          now(),
          source,
          product.freshness,
        ),
        manifest: entry.manifest as TManifest,
      })

      const memo = recall(key)
      if (memo && now() - memo.fetchedAtMs < (product.ttlMs ?? DEFAULT_TTL_MS)) {
        return present(memo, 'memo')
      }

      let flight = inFlight.get(key)
      if (!flight) {
        flight = load(product, context)
          .then((entry) => {
            remember(key, entry)
            return entry
          })
          .finally(() => {
            inFlight.delete(key)
          })
        inFlight.set(key, flight)
      }

      try {
        return present(await flight, 'upstream')
      } catch (error) {
        const maxStaleMs = product.maxStaleMs ?? 0
        const last = cache.get(key)
        if (last && maxStaleMs > 0 && now() - last.fetchedAtMs <= maxStaleMs) {
          return present(last, 'stale-if-error')
        }
        throw error
      }
    },
  }
}
