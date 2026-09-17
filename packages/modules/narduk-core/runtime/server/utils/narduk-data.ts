/**
 * Server-side client for published `narduk-data` products.
 *
 * Every Narduk app that reads a narduk-data product performs the same three
 * steps: fetch `<origin>/<product>/current/manifest.json`, fetch the immutable
 * artifact **the manifest names**, and check that artifact against the
 * manifest's SHA-256 before trusting a byte of it. Apps were re-deriving that
 * dance — and the timeout, retry, coalescing and freshness policy around it —
 * one server util at a time.
 *
 * Two layers live here, and nothing else is exported:
 *
 * - `fetchNardukDataJson` — one typed request: per-attempt timeout, a bounded
 *   retry that only ever applies to an idempotent `GET`/`HEAD`, a hard body-size
 *   ceiling, an origin pin, request-id propagation, and a response schema.
 * - `createNardukDataClient` — the product read built on top of it: manifest,
 *   artifact, checksum, consumer validation hooks, a short isolate-local memo,
 *   single-flight coalescing, an opt-in stale-if-error window with a failure
 *   cooldown, and freshness metadata.
 *
 * Truth is preserved rather than flattened. A value served from the fallback
 * path says so through `source`; a manifest that states no observation time
 * yields `state: 'unknown'` rather than `'fresh'`; the producer's own staleness
 * word is republished verbatim beside the derived verdict instead of being
 * mapped onto it; a cancelled caller is always told it was cancelled and is
 * never handed stale data instead; and a schema failure, a consumer rejection,
 * a checksum mismatch and an upstream outage stay distinct error reasons rather
 * than collapsing into an empty result.
 *
 * Cloudflare Workers constraints: no Node-only APIs, no module-level cache (the
 * caller owns a client instance, whose cache is bounded by both entry count and
 * retained bytes), and no timer this module has to clear — cancellation rides
 * on `AbortSignal`.
 */

/** Origin every published narduk-data product is served from. */
export const NARDUK_DATA_ORIGIN = 'https://data.nard.uk'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 1
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024
const DEFAULT_MANIFEST_MAX_BYTES = 256 * 1024
const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_ENTRIES = 8
const DEFAULT_MAX_CACHE_BYTES = 32 * 1024 * 1024
const DEFAULT_FAILURE_COOLDOWN_MS = 10_000
const REQUEST_ID_HEADER = 'x-request-id'

/**
 * Headers a caller may never forward to the data origin.
 *
 * A published product is public and needs no credential, so a caller's own
 * `authorization` or `cookie` reaching it would be a credential leak to a
 * different service, not a feature.
 */
const FORBIDDEN_FORWARD_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])

/** An artifact file name: one path segment, so a manifest cannot escape its release prefix. */
const ARTIFACT_PATH_PATTERN = /^[A-Za-z0-9][\w.-]*$/u

/**
 * Why a narduk-data read failed.
 *
 * - `aborted` — the caller's own signal cancelled its read.
 * - `checksum` — the artifact does not match its immutable manifest.
 * - `http` — the upstream answered a non-2xx status (see `status`).
 * - `network` — the request never produced a response.
 * - `rejected` — a consumer hook, the origin pin or the expected artifact path
 *   refused an otherwise well-formed response.
 * - `schema` — the body was not JSON, or did not satisfy the supplied schema.
 * - `timeout` — an attempt ran past its timeout.
 * - `too-large` — the body exceeded the caller's byte ceiling.
 */
export type NardukDataErrorReason =
  'aborted' | 'checksum' | 'http' | 'network' | 'rejected' | 'schema' | 'timeout' | 'too-large'

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
 * Per-request correlation, cancellation and fetch injection.
 *
 * `requestId` is sent as `x-request-id`; a request-id middleware supplies it
 * from the incoming request rather than this module generating one.
 *
 * `signal` cancels **this caller's read only**. It is deliberately not given to
 * the shared upstream read: one caller disconnecting must not fail the other
 * callers coalesced onto the same flight.
 */
export interface NardukDataRequestContext {
  /** Fetch implementation for this read, overriding the client's. */
  fetch?: typeof fetch
  /**
   * Extra request headers. `accept`, `user-agent` and `x-request-id` are
   * managed and cannot be overridden; `authorization`, `cookie` and
   * `proxy-authorization` are dropped.
   */
  headers?: Readonly<Record<string, string>>
  /** Correlation id propagated upstream as `x-request-id`. */
  requestId?: string
  /** Cancels this caller's read. Never cancels the shared upstream read. */
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
  /** Origin the URL must belong to. Defaults to `https://data.nard.uk`. */
  origin?: string
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
 * `manifestSchema` only has to produce at least this much. `newest_as_of` is
 * the newest observation in the release and `evaluated_at` is when the producer
 * cut it — they are different instants and this module keeps them apart.
 */
export interface NardukDataReleaseManifest {
  artifact: { path: string; sha256: string }
  releaseId: string
  staleness?: {
    age_minutes?: number | null
    evaluated_at?: string | null
    fresh_if_less_than_minutes?: number | null
    newest_as_of?: string | null
    state?: string | null
    warning_if_at_most_minutes?: number | null
  } | null
}

/** Derived freshness verdict. `unknown` is never quietly promoted to `fresh`. */
export type NardukDataFreshnessState = 'aging' | 'fresh' | 'stale' | 'unknown'

/**
 * When published data stops counting as current, mirroring the producer's own
 * `fresh_if_less_than_minutes` / `warning_if_at_most_minutes` boundaries.
 *
 * Omitted, the client falls back to the thresholds the manifest publishes; with
 * neither, the state is `unknown` rather than an invented verdict.
 */
export interface NardukDataFreshnessThresholds {
  /** Age up to and including which the state is `aging`; beyond it, `stale`. */
  agingAtMostMs: number
  /** Age below which the state is `fresh`. */
  freshBelowMs: number
}

/** Where a served value came from. */
export type NardukDataSource = 'memo' | 'stale-if-error' | 'upstream'

/**
 * Freshness metadata published beside every value this client returns.
 *
 * There is exactly one staleness signal a caller acts on — `source` says how
 * the value was served, `state` says how old the data is. An observation
 * timestamp in the future is reported as a negative `observedAgeMs` and counts
 * as `fresh`, because producer clock skew is not staleness.
 */
export interface NardukDataFreshness {
  /** Milliseconds since `fetchedAt`, by this isolate's clock. */
  ageMs: number
  /** When the producer cut the release; `null` when the manifest states none. */
  evaluatedAt: string | null
  /** When this client read the served value from upstream. */
  fetchedAt: string
  /** Age of `observedAt`; `null` when the manifest states no observation time. */
  observedAgeMs: number | null
  /** Newest observation in the release; `null` when the manifest states none. */
  observedAt: string | null
  /** The producer's own staleness word, verbatim and unmapped; `null` when absent. */
  publishedState: string | null
  /** Release the served value belongs to. */
  releaseId: string
  /** How this value was served. `stale-if-error` is the fallback path. */
  source: NardukDataSource
  /** Verdict derived from `observedAgeMs` and the thresholds in force. */
  state: NardukDataFreshnessState
}

/** One published product a client can read. */
export interface NardukDataProduct<
  TArtifact,
  TManifest extends NardukDataReleaseManifest = NardukDataReleaseManifest,
> {
  /**
   * Reject a release before its artifact is downloaded — a gate on
   * `staleness.state`, a lifecycle field, a provenance check. Throw to refuse;
   * the refusal is never cached.
   */
  acceptManifest?: (manifest: TManifest) => void
  /**
   * The artifact file name you expect inside the release. The URL is always
   * built from `manifest.artifact.path`; when this is set, a manifest naming a
   * different artifact is refused rather than silently followed.
   */
  artifactPath?: string
  /** Thresholds for the derived state; defaults to the manifest's own. */
  freshness?: NardukDataFreshnessThresholds
  /** Hard ceiling on the manifest body. Defaults to 256 KiB. */
  manifestMaxBytes?: number
  /** Stricter manifest validator; defaults to the shared release contract. */
  manifestSchema?: NardukDataSchema<TManifest>
  /** Hard ceiling on the artifact body. Defaults to 16 MiB. */
  maxBytes?: number
  /**
   * How long a last-good value may be served after an upstream failure,
   * measured from when that value was fetched — it never ratchets forward.
   * Defaults to 0: fail closed, exactly as a hand-rolled read does today.
   */
  maxStaleMs?: number
  /** Product family id, e.g. `buoy-status-v1`. */
  productId: string
  /** Validator the artifact must satisfy. */
  schema: NardukDataSchema<TArtifact>
  /** How long a value is served without re-reading upstream. Defaults to 60000. */
  ttlMs?: number
  /**
   * Cross-check the artifact against its manifest before the pair is cached.
   * Throw to refuse; the refusal is never cached.
   */
  validate?: (data: TArtifact, manifest: TManifest) => void
}

/** A product read: the artifact, its manifest, how fresh the pair is, and where it came from. */
export interface NardukDataResult<TArtifact, TManifest> {
  /** The artifact URL this value was read from — release provenance. */
  artifactUrl: string
  data: TArtifact
  freshness: NardukDataFreshness
  manifest: TManifest
  /** The manifest URL this value was resolved through. */
  manifestUrl: string
}

/** Options shared by every product one client reads. */
export interface NardukDataClientOptions {
  /**
   * After a failure that was answered from the stale window, how long to serve
   * stale without re-attempting upstream. Defaults to 10000. `0` disables the
   * cooldown, so every request re-pays the full retry budget during an outage.
   */
  failureCooldownMs?: number
  /** Fetch implementation; defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Retained artifact bytes held across all entries. Defaults to 32 MiB. */
  maxCacheBytes?: number
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
  /**
   * Drop every cached value for one `productId`, or the whole cache when called
   * bare. Clearing by id drops each validation variant of that product, so a
   * test or an invalidation hook does not have to reconstruct a cache key.
   */
  clear: (productId?: string) => void
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

function abortedError(url: string, cause?: unknown): NardukDataError {
  return new NardukDataError(
    `narduk-data read of ${url} was cancelled by the caller.`,
    'aborted',
    url,
    null,
    cause,
  )
}

/**
 * Correlation headers for one read.
 *
 * TODO(narduk-libs#395): narduk-logging is adding `requestIdHeaders(id)`. Adopt
 * it once that export is published; until then this stays local rather than
 * taking a dependency on an unmerged export.
 */
function correlationHeaders(requestId: string | undefined): Record<string, string> {
  return requestId ? { [REQUEST_ID_HEADER]: requestId } : {}
}

function requestHeaders(policy: NardukDataRequestPolicy): Record<string, string> {
  const headers: Record<string, string> = {}
  // Caller headers first, so the managed ones below cannot be overridden and a
  // credential-bearing header is dropped rather than forwarded.
  for (const [name, value] of Object.entries(policy.context?.headers ?? {})) {
    const lower = name.toLowerCase()
    if (!FORBIDDEN_FORWARD_HEADERS.has(lower)) headers[lower] = value
  }
  headers.accept = 'application/json'
  if (policy.userAgent) headers['user-agent'] = policy.userAgent
  return { ...headers, ...correlationHeaders(policy.context?.requestId) }
}

function tooLargeError(url: string, maxBytes: number): NardukDataError {
  return new NardukDataError(
    `narduk-data response from ${url} exceeds the ${maxBytes}-byte consumer ceiling.`,
    'too-large',
    url,
  )
}

/** Refuse a URL that does not belong to the origin this client was pointed at. */
function assertOrigin(url: string, origin: string): void {
  let actual: string
  let expected: string
  try {
    actual = new URL(url).origin
    expected = new URL(origin).origin
  } catch (error) {
    throw new NardukDataError(
      `narduk-data URL ${url} is not a valid URL.`,
      'rejected',
      url,
      null,
      error,
    )
  }
  if (actual !== expected) {
    throw new NardukDataError(
      `narduk-data URL ${url} is not on the configured origin ${expected}.`,
      'rejected',
      url,
    )
  }
}

/**
 * Read a body while holding `maxBytes` as a hard ceiling.
 *
 * The ceiling is enforced against bytes actually accumulated, so an upstream
 * that omits or lies about `content-length` cannot push more than one chunk
 * past it into isolate memory; the stream is cancelled rather than drained. A
 * single-chunk body is returned as-is, so the common small response never pays
 * for a merged copy.
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
  const chunks: Array<Uint8Array<ArrayBufferLike>> = []
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

  const only = chunks.length === 1 ? chunks[0] : undefined
  if (only && only.byteLength === byteCount && only.buffer instanceof ArrayBuffer) {
    return only as Uint8Array<ArrayBuffer>
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
  const fetcher = policy.context?.fetch ?? policy.fetch ?? fetch
  try {
    const response = await fetcher(url, {
      body: policy.body,
      headers: requestHeaders(policy),
      method,
      // A published artifact never redirects; following one off-origin would
      // defeat the origin pin, so a redirect is an error rather than a hop.
      redirect: 'error',
      signal: timeoutSignal,
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
        : abortedError(url, error)
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
 * attempt gets its own timeout, so one request costs at most
 * `(retries + 1) x timeoutMs`; there is no backoff sleep, and so no timer to
 * leave behind.
 */
async function requestBytes(
  url: string,
  policy: NardukDataRequestPolicy,
  method: string,
): Promise<Uint8Array<ArrayBuffer>> {
  assertOrigin(url, policy.origin ?? NARDUK_DATA_ORIGIN)
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

/** Run a consumer hook, reporting anything it throws as a refusal of this release. */
function runHook(url: string, label: string, hook: () => void): void {
  try {
    hook()
  } catch (error) {
    if (error instanceof NardukDataError) throw error
    throw new NardukDataError(
      `narduk-data release at ${url} was refused by ${label}.`,
      'rejected',
      url,
      null,
      error,
    )
  }
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

function finiteMinutesToMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value * 60_000 : null
}

/**
 * The thresholds in force for one read.
 *
 * A product's own thresholds win. Otherwise the producer's published
 * boundaries are used, so an app does not have to hardcode a duplicate that can
 * drift from the release it is reading.
 */
function resolveThresholds(
  declared: NardukDataFreshnessThresholds | undefined,
  manifest: NardukDataReleaseManifest,
): NardukDataFreshnessThresholds | null {
  if (declared) return declared
  const freshBelowMs = finiteMinutesToMs(manifest.staleness?.fresh_if_less_than_minutes)
  const agingAtMostMs = finiteMinutesToMs(manifest.staleness?.warning_if_at_most_minutes)
  return freshBelowMs === null || agingAtMostMs === null ? null : { agingAtMostMs, freshBelowMs }
}

function freshnessState(
  observedAgeMs: number | null,
  thresholds: NardukDataFreshnessThresholds | null,
): NardukDataFreshnessState {
  if (observedAgeMs === null || !thresholds) return 'unknown'
  if (observedAgeMs < thresholds.freshBelowMs) return 'fresh'
  if (observedAgeMs <= thresholds.agingAtMostMs) return 'aging'
  return 'stale'
}

function instantOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function describeFreshness(
  manifest: NardukDataReleaseManifest,
  fetchedAtMs: number,
  now: number,
  source: NardukDataSource,
  declared: NardukDataFreshnessThresholds | undefined,
): NardukDataFreshness {
  const observedAt = instantOrNull(manifest.staleness?.newest_as_of)
  const observedAgeMs = observedAt === null ? null : now - Date.parse(observedAt)
  const publishedState = manifest.staleness?.state
  return {
    ageMs: now - fetchedAtMs,
    evaluatedAt: instantOrNull(manifest.staleness?.evaluated_at),
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    observedAgeMs,
    observedAt,
    publishedState: typeof publishedState === 'string' ? publishedState : null,
    releaseId: manifest.releaseId,
    source,
    state: freshnessState(observedAgeMs, resolveThresholds(declared, manifest)),
  }
}

interface CacheEntry {
  artifactUrl: string
  /** Serve this entry without re-attempting upstream until this instant. */
  cooldownUntilMs: number
  data: unknown
  fetchedAtMs: number
  manifest: NardukDataReleaseManifest
  manifestUrl: string
  retainedBytes: number
}

function joinUrl(origin: string, ...segments: string[]): string {
  return [origin.replace(/\/+$/u, ''), ...segments].join('/')
}

/**
 * Wait for the shared read, but let this caller's own signal end its wait.
 *
 * The shared read is never given a caller's signal, so one caller walking away
 * cannot fail the others coalesced onto it. The listener is removed on every
 * path, so nothing is left attached to a long-lived signal.
 */
async function withCallerSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  url: string,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) throw abortedError(url, signal.reason)
  let onAbort = () => {}
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          reject(abortedError(url, signal.reason))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Create a narduk-data reader.
 *
 * One client per isolate is the intended shape: an app holds it at module scope
 * in its own server util so concurrent handlers share the memo and the
 * single-flight map. The cache lives on the instance and is bounded by both
 * `maxEntries` and `maxCacheBytes`, so even a module-scoped client cannot grow
 * without limit; `clear()` drops it, which is what a test suite wants between
 * cases.
 */
export function createNardukDataClient(options: NardukDataClientOptions = {}): NardukDataClient {
  const origin = options.origin ?? NARDUK_DATA_ORIGIN
  const now = options.now ?? (() => Date.now())
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const maxCacheBytes = Math.max(0, options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES)
  const failureCooldownMs = Math.max(0, options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS)
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<CacheEntry>>()
  // Identity of the objects that decide whether a cached value is valid for a
  // caller. Weak, so a schema that goes out of scope does not pin an id.
  const identities = new WeakMap<object, number>()
  let nextIdentity = 0

  function identityOf(value: unknown): string {
    if (typeof value !== 'object' && typeof value !== 'function') return '-'
    if (value === null) return '-'
    const object = value as object
    let id = identities.get(object)
    if (id === undefined) {
      nextIdentity += 1
      id = nextIdentity
      identities.set(object, id)
    }
    return String(id)
  }

  /**
   * The cache key.
   *
   * Everything that decides what a read returns is in it: the product, the
   * ceilings that bound the fetch, and the identity of every validator and hook
   * that has to agree before a value counts as valid — plus the fetcher, since
   * a different fetcher is a different upstream. Two callers with different
   * contracts therefore get two entries instead of one silently answering for
   * the other.
   *
   * Keying was chosen over caching raw bytes and re-validating per serve
   * because the artifact is multi-megabyte: re-parsing it on every request
   * would put a JSON parse of the whole product on the hot path of every
   * Worker invocation. Distinct contracts genuinely are distinct values.
   */
  function cacheKey<TArtifact, TManifest extends NardukDataReleaseManifest>(
    product: NardukDataProduct<TArtifact, TManifest>,
    context: NardukDataRequestContext | undefined,
  ): string {
    return [
      product.productId,
      product.artifactPath ?? '',
      product.maxBytes ?? DEFAULT_MAX_BYTES,
      product.manifestMaxBytes ?? DEFAULT_MANIFEST_MAX_BYTES,
      identityOf(product.schema),
      identityOf(product.manifestSchema),
      identityOf(product.validate),
      identityOf(product.acceptManifest),
      identityOf(context?.fetch ?? options.fetch),
    ].join('\0')
  }

  function retainedBytes(): number {
    let total = 0
    for (const entry of cache.values()) total += entry.retainedBytes
    return total
  }

  function remember(key: string, entry: CacheEntry): void {
    cache.delete(key)
    cache.set(key, entry)
    let held = retainedBytes()
    while (cache.size > maxEntries || (held > maxCacheBytes && cache.size > 1)) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      held -= cache.get(oldest.value)?.retainedBytes ?? 0
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
    manifestUrl: string,
  ): Promise<CacheEntry> {
    // The shared read carries the first caller's correlation and fetcher, but
    // never a caller's signal: cancellation is raced per caller instead.
    const policy: NardukDataRequestPolicy = {
      context: { fetch: context?.fetch, headers: context?.headers, requestId: context?.requestId },
      fetch: options.fetch,
      origin,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent,
    }
    const manifest = await fetchNardukDataJson(manifestUrl, {
      ...policy,
      maxBytes: product.manifestMaxBytes ?? DEFAULT_MANIFEST_MAX_BYTES,
      schema: product.manifestSchema ?? (releaseManifestSchema as NardukDataSchema<TManifest>),
    })

    if (product.acceptManifest) {
      const accept = product.acceptManifest
      runHook(manifestUrl, 'acceptManifest', () => {
        accept(manifest)
      })
    }

    const artifactName = manifest.artifact.path
    if (!ARTIFACT_PATH_PATTERN.test(artifactName)) {
      throw new NardukDataError(
        `narduk-data manifest at ${manifestUrl} names an unusable artifact path.`,
        'rejected',
        manifestUrl,
      )
    }
    if (product.artifactPath !== undefined && product.artifactPath !== artifactName) {
      throw new NardukDataError(
        `narduk-data manifest at ${manifestUrl} names artifact '${artifactName}', not the expected '${product.artifactPath}'.`,
        'rejected',
        manifestUrl,
      )
    }

    const artifactUrl = joinUrl(
      origin,
      encodeURIComponent(product.productId),
      'releases',
      encodeURIComponent(manifest.releaseId),
      encodeURIComponent(artifactName),
    )
    const bytes = await requestBytes(
      artifactUrl,
      { ...policy, maxBytes: product.maxBytes ?? DEFAULT_MAX_BYTES },
      'GET',
    )
    const observed = await sha256Hex(bytes)
    if (observed !== manifest.artifact.sha256.toLowerCase()) {
      throw new NardukDataError(
        `narduk-data artifact ${artifactUrl} does not match the SHA-256 in its immutable manifest.`,
        'checksum',
        artifactUrl,
      )
    }

    const data = applySchema(artifactUrl, decodeJson(artifactUrl, bytes), product.schema)
    if (product.validate) {
      const validate = product.validate
      runHook(artifactUrl, 'validate', () => {
        validate(data, manifest)
      })
    }

    return {
      artifactUrl,
      cooldownUntilMs: 0,
      data,
      fetchedAtMs: now(),
      manifest,
      manifestUrl,
      retainedBytes: bytes.byteLength,
    }
  }

  return {
    clear(productId) {
      if (productId === undefined) {
        cache.clear()
        return
      }
      const prefix = `${productId}\u0000`
      for (const key of [...cache.keys()]) {
        if (key.startsWith(prefix)) cache.delete(key)
      }
    },

    async read<TArtifact, TManifest extends NardukDataReleaseManifest>(
      product: NardukDataProduct<TArtifact, TManifest>,
      context?: NardukDataRequestContext,
    ): Promise<NardukDataResult<TArtifact, TManifest>> {
      const key = cacheKey(product, context)
      const manifestUrl = joinUrl(
        origin,
        encodeURIComponent(product.productId),
        'current',
        'manifest.json',
      )
      const present = (entry: CacheEntry, source: NardukDataSource) => ({
        artifactUrl: entry.artifactUrl,
        data: entry.data as TArtifact,
        freshness: describeFreshness(
          entry.manifest,
          entry.fetchedAtMs,
          now(),
          source,
          product.freshness,
        ),
        manifest: entry.manifest as TManifest,
        manifestUrl: entry.manifestUrl,
      })
      const maxStaleMs = product.maxStaleMs ?? 0
      const servableStale = (entry: CacheEntry | undefined, at: number) =>
        entry !== undefined && maxStaleMs > 0 && at - entry.fetchedAtMs <= maxStaleMs

      const memo = recall(key)
      const startedAt = now()
      if (memo && startedAt - memo.fetchedAtMs < (product.ttlMs ?? DEFAULT_TTL_MS)) {
        return present(memo, 'memo')
      }
      // An upstream that has just failed is not retried by every request in the
      // burst: while the cooldown holds and a stale value is still servable, it
      // is served without paying the retry budget again.
      if (memo && startedAt < memo.cooldownUntilMs && servableStale(memo, startedAt)) {
        return present(memo, 'stale-if-error')
      }

      let flight = inFlight.get(key)
      if (!flight) {
        flight = load(product, context, manifestUrl)
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
        return present(await withCallerSignal(flight, context?.signal, manifestUrl), 'upstream')
      } catch (error) {
        // A caller that cancelled is told it cancelled. Handing it stale data
        // instead would answer a question it withdrew.
        if (error instanceof NardukDataError && error.reason === 'aborted') throw error
        const failedAt = now()
        const last = recall(key)
        if (servableStale(last, failedAt) && last) {
          last.cooldownUntilMs = failedAt + failureCooldownMs
          return present(last, 'stale-if-error')
        }
        throw error
      }
    },
  }
}
