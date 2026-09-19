import { describe, expect, it } from 'vitest'

import {
  createNardukDataClient,
  fetchNardukDataJson,
  NARDUK_DATA_ORIGIN,
  NardukDataError,
} from '../runtime/server/utils/narduk-data'

import type {
  NardukDataProduct,
  NardukDataReleaseManifest,
  NardukDataSchema,
} from '../runtime/server/utils/narduk-data'

const ORIGIN = 'https://data.example.test'
const PRODUCT_ID = 'buoy-status-v1'
const ARTIFACT_PATH = 'public-buoy-data.json'
const RELEASE_ID = 'buoy-status-v1-20260917T120000Z-0123456789ab'
const OBSERVED_AT = '2026-09-17T12:00:00.000Z'
const EVALUATED_AT = '2026-09-17T12:05:00.000Z'
const NOW = Date.parse('2026-09-17T12:10:00.000Z')

const STALE_IF_ERROR = 'stale-if-error'

const manifestUrl = `${ORIGIN}/${PRODUCT_ID}/current/manifest.json`
const artifactUrl = `${ORIGIN}/${PRODUCT_ID}/releases/${RELEASE_ID}/${ARTIFACT_PATH}`

interface Payload {
  stations: string[]
}

/** A minimal structural stand-in for a zod schema, so the test owns the verdict. */
function schemaOf<T>(check: (value: unknown) => boolean): NardukDataSchema<T> {
  return {
    safeParse: (value) =>
      check(value) ? { data: value as T, success: true } : { error: 'nope', success: false },
  }
}

const payloadSchema = schemaOf<Payload>(
  (value) =>
    typeof value === 'object' && value !== null && Array.isArray((value as Payload).stations),
)

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function json(body: string, status = 200): Response {
  return new Response(body, { headers: { 'content-type': 'application/json' }, status })
}

/**
 * A published release the client should accept end to end.
 *
 * The checksum is computed from the exact artifact text, so a test that tampers
 * with either half exercises the real integrity check rather than a stub of it.
 */
async function publishedRelease(payload: Payload = { stations: ['41008'] }) {
  const artifactText = JSON.stringify(payload)
  const manifest = {
    artifact: { path: ARTIFACT_PATH, sha256: await sha256Hex(artifactText) },
    immutable: true,
    product_family_id: PRODUCT_ID,
    releaseId: RELEASE_ID,
    staleness: {
      age_minutes: 10,
      evaluated_at: EVALUATED_AT,
      newest_as_of: OBSERVED_AT,
      state: 'current',
    },
  }
  return { artifactText, manifest, manifestText: JSON.stringify(manifest) }
}

interface FakeFetch {
  calls: Array<{ headers: Record<string, string>; method: string; url: string }>
  fetch: typeof fetch
}

/**
 * Reject when `signal` aborts, the way a real `fetch` does.
 *
 * Without this the fake would swallow cancellation and no test could observe
 * whose abort ended whose request — the exact blind spot that let a caller's
 * signal reach the shared single-flight unnoticed.
 */
function abortRejection(signal: AbortSignal): { cleanup: () => void; promise: Promise<never> } {
  let cleanup = () => {}
  const promise = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }
  })
  promise.catch(() => {})
  return { cleanup, promise }
}

/** Record every call, and answer from a per-URL queue of responders. */
function fakeFetch(routes: Record<string, Array<() => Promise<Response>>>): FakeFetch {
  const calls: FakeFetch['calls'] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[name] = value
    }
    calls.push({ headers, method: init?.method ?? 'GET', url })
    const queue = routes[url]
    // A one-entry queue is the steady-state answer; a longer one is consumed in
    // order, so a test can script "fail, then succeed" without a counter.
    const responder = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!responder) throw new TypeError(`unexpected request: ${url}`)
    if (!init?.signal) return responder()
    const abort = abortRejection(init.signal)
    try {
      return await Promise.race([responder(), abort.promise])
    } finally {
      abort.cleanup()
    }
  }) as unknown as typeof fetch
  return { calls, fetch: fetcher }
}

/** A gate a test opens by hand, so a read can be held mid-flight. */
function gate(): { open: () => void; passed: Promise<void> } {
  let open = () => {}
  const passed = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, passed }
}

/** A fetch that never answers, so only the timeout can end the attempt. */
function hangingFetch(): FakeFetch {
  const calls: FakeFetch['calls'] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ headers: {}, method: init?.method ?? 'GET', url: String(input) })
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
      })
    })
  }) as unknown as typeof fetch
  return { calls, fetch: fetcher }
}

function productOf(
  overrides: Partial<NardukDataProduct<Payload>> = {},
): NardukDataProduct<Payload> {
  return {
    artifactPath: ARTIFACT_PATH,
    freshness: { agingAtMostMs: 2 * 60 * 60_000, freshBelowMs: 30 * 60_000 },
    productId: PRODUCT_ID,
    schema: payloadSchema,
    ...overrides,
  }
}

async function successRoutes(payload?: Payload) {
  const release = await publishedRelease(payload)
  return {
    release,
    routes: {
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText)],
    },
  }
}

describe('narduk-data client', () => {
  it('defaults to the published narduk-data origin', () => {
    expect(NARDUK_DATA_ORIGIN).toBe('https://data.nard.uk')
  })

  it('reads a release, verifies its checksum and reports freshness', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const result = await client.read(productOf())

    expect(result.data.stations).toEqual(['41008'])
    expect(result.manifest.releaseId).toBe(RELEASE_ID)
    expect(result.freshness).toMatchObject({
      ageMs: 0,
      evaluatedAt: EVALUATED_AT,
      observedAgeMs: 600_000,
      observedAt: OBSERVED_AT,
      publishedState: 'current',
      releaseId: RELEASE_ID,
      source: 'upstream',
      state: 'fresh',
    })
    expect(result.manifestUrl).toBe(manifestUrl)
    expect(result.artifactUrl).toBe(artifactUrl)
    expect(upstream.calls.map((call) => call.url)).toEqual([manifestUrl, artifactUrl])
  })

  it('propagates a request id and caller headers upstream', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => NOW,
      origin: ORIGIN,
      userAgent: 'BuoyStat.us/1.0',
    })

    await client.read(productOf(), { headers: { 'X-Trace': 'abc' }, requestId: 'req-42' })

    for (const call of upstream.calls) {
      expect(call.headers['x-request-id']).toBe('req-42')
      expect(call.headers['x-trace']).toBe('abc')
      expect(call.headers['user-agent']).toBe('BuoyStat.us/1.0')
    }
  })

  it('serves a second read from the memo without touching the network', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await client.read(productOf())
    const second = await client.read(productOf())

    expect(second.freshness.source).toBe('memo')
    expect(upstream.calls).toHaveLength(2)
  })

  it('revalidates an unchanged release with the manifest alone and keeps the value', async () => {
    const { release } = await successRoutes()
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText), async () => json('', 500)],
      [manifestUrl]: [async () => json(release.manifestText)],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
    })
    const product = productOf({ ttlMs: 60_000 })

    const first = await client.read(product)
    clock = NOW + 2 * 60_000
    const second = await client.read(product)

    expect(second.data).toBe(first.data)
    expect(second.freshness).toMatchObject({ ageMs: 0, source: 'upstream' })
    expect(upstream.calls.map((call) => call.url)).toEqual([manifestUrl, artifactUrl, manifestUrl])
  })

  it('still runs validate against the manifest a revalidation reads', async () => {
    const { release } = await successRoutes()
    const refused = JSON.stringify({
      ...release.manifest,
      staleness: { ...release.manifest.staleness, state: 'withdrawn' },
    })
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText), async () => json(refused)],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const product = productOf({
      ttlMs: 60_000,
      validate: (_data, manifest) => {
        if (manifest.staleness?.state === 'withdrawn') throw new Error('withdrawn')
      },
    })

    await client.read(product)
    clock = NOW + 2 * 60_000

    await expect(client.read(product)).rejects.toMatchObject({ reason: 'rejected' })
    expect(upstream.calls.filter((call) => call.url === artifactUrl)).toHaveLength(1)
  })

  it('downloads the new release once the current pointer moves', async () => {
    const { release } = await successRoutes()
    const nextReleaseId = 'buoy-status-v1-20260917T130000Z-0123456789ab'
    const next = await publishedRelease({ stations: ['41009'] })
    const nextManifest = JSON.stringify({ ...next.manifest, releaseId: nextReleaseId })
    const nextArtifactUrl = `${ORIGIN}/${PRODUCT_ID}/releases/${nextReleaseId}/${ARTIFACT_PATH}`
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText), async () => json(nextManifest)],
      [nextArtifactUrl]: [async () => json(next.artifactText)],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
    })
    const product = productOf({ ttlMs: 60_000 })

    await client.read(product)
    clock = NOW + 2 * 60_000
    const moved = await client.read(product)

    expect(moved.data.stations).toEqual(['41009'])
    expect(moved.manifest.releaseId).toBe(nextReleaseId)
    expect(upstream.calls.at(-1)?.url).toBe(nextArtifactUrl)
  })

  it('re-downloads when a manifest names a different checksum for the same release', async () => {
    const { release } = await successRoutes()
    const changed = await publishedRelease({ stations: ['41009'] })
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [
        async () => json(release.artifactText),
        async () => json(changed.artifactText),
      ],
      [manifestUrl]: [
        async () => json(release.manifestText),
        async () => json(changed.manifestText),
      ],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
    })
    const product = productOf({ ttlMs: 60_000 })

    await client.read(product)
    clock = NOW + 2 * 60_000
    const reread = await client.read(product)

    expect(reread.data.stations).toEqual(['41009'])
    expect(upstream.calls.filter((call) => call.url === artifactUrl)).toHaveLength(2)
  })

  it('coalesces concurrent readers of the same product onto one upstream read', async () => {
    const { release } = await successRoutes()
    let releaseArtifact = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseArtifact = resolve
    })
    const upstream = fakeFetch({
      [artifactUrl]: [
        async () => {
          await gate
          return json(release.artifactText)
        },
      ],
      [manifestUrl]: [async () => json(release.manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const readers = Array.from({ length: 5 }, () => client.read(productOf()))
    await Promise.resolve()
    releaseArtifact()
    const results = await Promise.all(readers)

    expect(results.every((result) => result.freshness.source === 'upstream')).toBe(true)
    expect(upstream.calls.filter((call) => call.url === manifestUrl)).toHaveLength(1)
    expect(upstream.calls.filter((call) => call.url === artifactUrl)).toHaveLength(1)
  })

  it('retries an idempotent GET once by default and then succeeds', async () => {
    const { release } = await successRoutes()
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json('', 503), async () => json(release.manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const result = await client.read(productOf())

    expect(result.data.stations).toEqual(['41008'])
    expect(upstream.calls.filter((call) => call.url === manifestUrl)).toHaveLength(2)
  })

  it('bounds the retry budget and surfaces the upstream status', async () => {
    const upstream = fakeFetch({ [manifestUrl]: [async () => json('', 500)] })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => NOW,
      origin: ORIGIN,
      retries: 2,
    })

    const error = await client.read(productOf()).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NardukDataError)
    expect(error).toMatchObject({ reason: 'http', status: 500 })
    expect(upstream.calls).toHaveLength(3)
  })

  it('never retries a 4xx', async () => {
    const upstream = fakeFetch({ [manifestUrl]: [async () => json('', 404)] })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf())).rejects.toMatchObject({ reason: 'http', status: 404 })
    expect(upstream.calls).toHaveLength(1)
  })

  it('never retries a non-GET request', async () => {
    const upstream = fakeFetch({ [manifestUrl]: [async () => json('', 503)] })

    const error = await fetchNardukDataJson(manifestUrl, {
      body: '{}',
      fetch: upstream.fetch,
      method: 'POST',
      origin: ORIGIN,
      retries: 3,
      schema: payloadSchema,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ reason: 'http', status: 503 })
    expect(upstream.calls).toHaveLength(1)
    expect(upstream.calls[0]?.method).toBe('POST')
  })

  it('fails a request that runs past its timeout, after its retries', async () => {
    const upstream = hangingFetch()
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => NOW,
      origin: ORIGIN,
      retries: 1,
      timeoutMs: 5,
    })

    const error = await client.read(productOf()).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NardukDataError)
    expect(error).toMatchObject({ reason: 'timeout', status: null })
    expect(upstream.calls).toHaveLength(2)
  })

  it('reports a caller abort as aborted rather than a timeout', async () => {
    const upstream = hangingFetch()
    const controller = new AbortController()
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => NOW,
      origin: ORIGIN,
      timeoutMs: 60_000,
    })

    const reading = client.read(productOf(), { signal: controller.signal })
    controller.abort()

    await expect(reading).rejects.toMatchObject({ reason: 'aborted' })
  })

  it('serves the last good value inside the stale-if-error window', async () => {
    const { release } = await successRoutes()
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText), async () => json('', 500)],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const product = productOf({ maxStaleMs: 10 * 60_000, ttlMs: 60_000 })

    await client.read(product)
    clock = NOW + 5 * 60_000
    const stale = await client.read(product)

    expect(stale.data.stations).toEqual(['41008'])
    expect(stale.freshness).toMatchObject({ ageMs: 5 * 60_000, source: STALE_IF_ERROR })
    expect(stale.freshness).not.toHaveProperty('stale')
  })

  it('fails once the stale-if-error window has passed', async () => {
    const { release } = await successRoutes()
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText), async () => json('', 500)],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const product = productOf({ maxStaleMs: 10 * 60_000, ttlMs: 60_000 })

    await client.read(product)
    clock = NOW + 11 * 60_000

    await expect(client.read(product)).rejects.toMatchObject({ reason: 'http', status: 500 })
  })

  it('fails closed when no stale window is configured', async () => {
    const { release } = await successRoutes()
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText), async () => json('', 500)],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const product = productOf({ ttlMs: 60_000 })

    await client.read(product)
    clock = NOW + 2 * 60_000

    await expect(client.read(product)).rejects.toMatchObject({ reason: 'http', status: 500 })
  })

  it('evicts the least recently used product once the cache bound is reached', async () => {
    const releases = await Promise.all(
      ['a', 'b', 'c'].map(async (name) => ({
        name,
        release: await publishedRelease({ stations: [name] }),
      })),
    )
    let clock = NOW
    const routes: Record<string, Array<() => Promise<Response>>> = {}
    for (const { name, release } of releases) {
      const base = `${ORIGIN}/${PRODUCT_ID}-${name}`
      routes[`${base}/current/manifest.json`] = [
        async () => json(release.manifestText),
        async () => json('', 500),
      ]
      routes[`${base}/releases/${RELEASE_ID}/${ARTIFACT_PATH}`] = [
        async () => json(release.artifactText),
      ]
    }
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      maxEntries: 2,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const productNamed = (name: string) =>
      productOf({ maxStaleMs: 60 * 60_000, productId: `${PRODUCT_ID}-${name}`, ttlMs: 1 })

    await client.read(productNamed('a'))
    await client.read(productNamed('b'))
    await client.read(productNamed('c'))
    clock = NOW + 1_000

    // 'a' was evicted by 'c', so its stale window has nothing to serve, while
    // 'b' and 'c' are still held and answer from the stale path.
    await expect(client.read(productNamed('a'))).rejects.toMatchObject({ reason: 'http' })
    await expect(client.read(productNamed('b'))).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
    await expect(client.read(productNamed('c'))).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
  })

  it('rejects an artifact whose checksum does not match its manifest', async () => {
    const release = await publishedRelease()
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(JSON.stringify({ stations: ['tampered'] }))],
      [manifestUrl]: [async () => json(release.manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf())).rejects.toMatchObject({ reason: 'checksum' })
  })

  it('treats a schema failure as an error state and does not retry it', async () => {
    const release = await publishedRelease({ stations: ['41008'] })
    const wrongShape = JSON.stringify({ stations: 'not-an-array' })
    const upstream = fakeFetch({
      [`${ORIGIN}/${PRODUCT_ID}/releases/${RELEASE_ID}/${ARTIFACT_PATH}`]: [
        async () => json(wrongShape),
      ],
      [manifestUrl]: [
        async () =>
          json(
            JSON.stringify({
              ...release.manifest,
              artifact: { path: ARTIFACT_PATH, sha256: await sha256Hex(wrongShape) },
            }),
          ),
      ],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf())).rejects.toMatchObject({ reason: 'schema' })
    expect(upstream.calls.filter((call) => call.url === artifactUrl)).toHaveLength(1)
  })

  it('rejects a manifest that cannot address an immutable artifact', async () => {
    const upstream = fakeFetch({
      [manifestUrl]: [async () => json(JSON.stringify({ releaseId: RELEASE_ID }))],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf())).rejects.toMatchObject({ reason: 'schema' })
  })

  it('refuses an artifact larger than the configured ceiling', async () => {
    const release = await publishedRelease({ stations: ['41008'] })
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf({ maxBytes: 4 }))).rejects.toMatchObject({
      reason: 'too-large',
    })
  })

  it('reports unknown freshness rather than fresh when the manifest states no publish time', async () => {
    const artifactText = JSON.stringify({ stations: [] })
    const manifest = {
      artifact: { path: ARTIFACT_PATH, sha256: await sha256Hex(artifactText) },
      releaseId: RELEASE_ID,
    }
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(artifactText)],
      [manifestUrl]: [async () => json(JSON.stringify(manifest))],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const result = await client.read(productOf())

    // A product that published nothing is proven-empty, not missing; the age of
    // that publication is unknown, and neither is reported as fresh.
    expect(result.data.stations).toEqual([])
    expect(result.freshness).toMatchObject({
      evaluatedAt: null,
      observedAgeMs: null,
      observedAt: null,
      publishedState: null,
      state: 'unknown',
    })
  })

  it('reports unknown freshness when the product declares no thresholds', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const result = await client.read(productOf({ freshness: undefined }))

    expect(result.freshness.observedAgeMs).toBe(600_000)
    expect(result.freshness.state).toBe('unknown')
  })

  it('derives aging and stale from the product thresholds', async () => {
    const { routes } = await successRoutes()
    const agingClient = createNardukDataClient({
      fetch: fakeFetch(routes).fetch,
      now: () => Date.parse(OBSERVED_AT) + 45 * 60_000,
      origin: ORIGIN,
    })
    const staleClient = createNardukDataClient({
      fetch: fakeFetch(routes).fetch,
      now: () => Date.parse(OBSERVED_AT) + 6 * 60 * 60_000,
      origin: ORIGIN,
    })

    await expect(agingClient.read(productOf())).resolves.toMatchObject({
      freshness: { state: 'aging' },
    })
    await expect(staleClient.read(productOf())).resolves.toMatchObject({
      freshness: { state: 'stale' },
    })
  })

  it('accepts a stricter caller-supplied manifest schema', async () => {
    const { release, routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })
    const manifestSchema = schemaOf<NardukDataReleaseManifest & { product_family_id: string }>(
      (value) => (value as { product_family_id?: string }).product_family_id === PRODUCT_ID,
    )

    const result = await client.read({ ...productOf(), manifestSchema })

    expect(result.manifest.product_family_id).toBe(PRODUCT_ID)
    expect(result.manifest.artifact.sha256).toBe(release.manifest.artifact.sha256)
  })

  // ── Review round 1 blockers ────────────────────────────────────────────────

  it('B1: one caller aborting does not kill the shared flight for everyone', async () => {
    const { release } = await successRoutes()
    const held = gate()
    const upstream = fakeFetch({
      [artifactUrl]: [
        async () => {
          await held.passed
          return json(release.artifactText)
        },
      ],
      [manifestUrl]: [async () => json(release.manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })
    const controller = new AbortController()

    const first = client.read(productOf(), { signal: controller.signal })
    const second = client.read(productOf())
    await Promise.resolve()
    controller.abort()
    held.open()

    await expect(first).rejects.toMatchObject({ reason: 'aborted' })
    await expect(second).resolves.toMatchObject({ data: { stations: ['41008'] } })
  })

  it('B2: a stricter schema is not answered from a permissive caller memo', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })
    const refuseEverything = schemaOf<Payload>(() => false)

    await client.read(productOf())

    await expect(client.read(productOf({ schema: refuseEverything }))).rejects.toMatchObject({
      reason: 'schema',
    })
  })

  it('B2: a smaller byte ceiling is not answered from a larger caller memo', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await client.read(productOf())

    await expect(client.read(productOf({ maxBytes: 4 }))).rejects.toMatchObject({
      reason: 'too-large',
    })
  })

  it('B3: a cancelled caller gets its cancellation, never stale data', async () => {
    const { release } = await successRoutes()
    let clock = NOW
    const held = gate()
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [
        async () => json(release.manifestText),
        async () => {
          await held.passed
          return json('', 500)
        },
      ],
    })
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const product = productOf({ maxStaleMs: 10 * 60_000, ttlMs: 60_000 })
    const controller = new AbortController()

    await client.read(product)
    clock = NOW + 5 * 60_000
    const cancelled = client.read(product, { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    held.open()

    await expect(cancelled).rejects.toMatchObject({ reason: 'aborted' })
  })

  it('B4: an outage with a usable stale entry stops re-paying the retry budget', async () => {
    const { release } = await successRoutes()
    let clock = NOW
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [manifestUrl]: [async () => json(release.manifestText), async () => json('', 500)],
    })
    const client = createNardukDataClient({
      failureCooldownMs: 10_000,
      fetch: upstream.fetch,
      now: () => clock,
      origin: ORIGIN,
      retries: 1,
    })
    const product = productOf({ maxStaleMs: 60 * 60_000, ttlMs: 1_000 })

    await client.read(product)
    const afterWarm = upstream.calls.length

    clock = NOW + 5_000
    await expect(client.read(product)).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
    const afterFirstFailure = upstream.calls.length
    // The failing read pays its own budget once: two manifest attempts.
    expect(afterFirstFailure - afterWarm).toBe(2)

    clock = NOW + 6_000
    await expect(client.read(product)).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
    clock = NOW + 7_000
    await expect(client.read(product)).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
    // Inside the cooldown the stale value is served with no upstream attempt.
    expect(upstream.calls.length).toBe(afterFirstFailure)

    clock = NOW + 20_000
    await expect(client.read(product)).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
    // Past the cooldown the client tries upstream again rather than serving
    // stale forever.
    expect(upstream.calls.length).toBe(afterFirstFailure + 2)
  })

  // ── Review round 1 should-fixes ────────────────────────────────────────────

  it('S1: clear() drops the memo so the next read goes upstream again', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await client.read(productOf())
    client.clear()
    const second = await client.read(productOf())

    expect(second.freshness.source).toBe('upstream')
    expect(upstream.calls).toHaveLength(4)
  })

  it('S1: a per-call fetch overrides the client fetch', async () => {
    const { routes } = await successRoutes()
    const clientLevel = fakeFetch({})
    const perCall = fakeFetch(routes)
    const client = createNardukDataClient({
      fetch: clientLevel.fetch,
      now: () => NOW,
      origin: ORIGIN,
    })

    const result = await client.read(productOf(), { fetch: perCall.fetch })

    expect(result.data.stations).toEqual(['41008'])
    expect(clientLevel.calls).toHaveLength(0)
    expect(perCall.calls).toHaveLength(2)
  })

  it('S2: acceptManifest refuses a release before the artifact is fetched, and is not cached', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })
    const product = productOf({
      acceptManifest: (manifest) => {
        if (manifest.staleness?.state === 'current') throw new Error('gate says no')
      },
    })

    await expect(client.read(product)).rejects.toMatchObject({ reason: 'rejected' })
    expect(upstream.calls.filter((call) => call.url === artifactUrl)).toHaveLength(0)

    // A refusal is a verdict about this release, never a cached value.
    await expect(client.read(product)).rejects.toMatchObject({ reason: 'rejected' })
    expect(upstream.calls.filter((call) => call.url === manifestUrl)).toHaveLength(2)
  })

  it('S2: validate refuses a release before it is remembered', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })
    const product = productOf({
      validate: (data, manifest) => {
        if (data.stations.length > 0 && manifest.releaseId === RELEASE_ID) {
          throw new Error('artifact disagrees with its manifest')
        }
      },
    })

    await expect(client.read(product)).rejects.toMatchObject({ reason: 'rejected' })
    await expect(client.read(product)).rejects.toMatchObject({ reason: 'rejected' })
    expect(upstream.calls.filter((call) => call.url === artifactUrl)).toHaveLength(2)
  })

  it('S3: the artifact URL comes from the manifest, not from the product', async () => {
    const artifactText = JSON.stringify({ stations: ['renamed'] })
    const manifest = {
      artifact: { path: 'renamed-v2.json', sha256: await sha256Hex(artifactText) },
      releaseId: RELEASE_ID,
    }
    const renamedUrl = `${ORIGIN}/${PRODUCT_ID}/releases/${RELEASE_ID}/renamed-v2.json`
    const upstream = fakeFetch({
      [manifestUrl]: [async () => json(JSON.stringify(manifest))],
      [renamedUrl]: [async () => json(artifactText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const result = await client.read(productOf({ artifactPath: undefined }))

    expect(result.data.stations).toEqual(['renamed'])
    expect(result.artifactUrl).toBe(renamedUrl)
  })

  it('S3: a manifest naming a different artifact than the product expects is refused', async () => {
    const artifactText = JSON.stringify({ stations: ['renamed'] })
    const manifest = {
      artifact: { path: 'renamed-v2.json', sha256: await sha256Hex(artifactText) },
      releaseId: RELEASE_ID,
    }
    const upstream = fakeFetch({ [manifestUrl]: [async () => json(JSON.stringify(manifest))] })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf())).rejects.toMatchObject({ reason: 'rejected' })
    expect(upstream.calls).toHaveLength(1)
  })

  it('S3: a manifest artifact path that escapes its release prefix is refused', async () => {
    const manifest = {
      artifact: { path: '../../../other-product/secret.json', sha256: 'a'.repeat(64) },
      releaseId: RELEASE_ID,
    }
    const upstream = fakeFetch({ [manifestUrl]: [async () => json(JSON.stringify(manifest))] })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf({ artifactPath: undefined }))).rejects.toMatchObject({
      reason: 'rejected',
    })
    expect(upstream.calls).toHaveLength(1)
  })

  it('S4: the manifest thresholds are used when the product declares none', async () => {
    const artifactText = JSON.stringify({ stations: ['41008'] })
    const manifest = {
      artifact: { path: ARTIFACT_PATH, sha256: await sha256Hex(artifactText) },
      releaseId: RELEASE_ID,
      staleness: {
        fresh_if_less_than_minutes: 90,
        newest_as_of: OBSERVED_AT,
        state: 'fresh',
        warning_if_at_most_minutes: 360,
      },
    }
    const routes = {
      [artifactUrl]: [async () => json(artifactText)],
      [manifestUrl]: [async () => json(JSON.stringify(manifest))],
    }
    const at = (minutes: number) =>
      createNardukDataClient({
        fetch: fakeFetch(routes).fetch,
        now: () => Date.parse(OBSERVED_AT) + minutes * 60_000,
        origin: ORIGIN,
      }).read(productOf({ freshness: undefined }))

    await expect(at(10)).resolves.toMatchObject({ freshness: { state: 'fresh' } })
    await expect(at(120)).resolves.toMatchObject({ freshness: { state: 'aging' } })
    await expect(at(400)).resolves.toMatchObject({ freshness: { state: 'stale' } })
  })

  it('S7: a caller cannot forward a credential or override the managed accept header', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await client.read(productOf(), {
      headers: { accept: 'text/html', Authorization: 'Bearer super-secret', Cookie: 'session=1' },
    })

    for (const call of upstream.calls) {
      expect(call.headers).not.toHaveProperty('authorization')
      expect(call.headers).not.toHaveProperty('cookie')
      expect(call.headers.accept).toBe('application/json')
    }
  })

  it('S7: a URL off the configured origin is refused before any request', async () => {
    const upstream = fakeFetch({})

    await expect(
      fetchNardukDataJson('https://evil.example.test/buoy-status-v1/current/manifest.json', {
        fetch: upstream.fetch,
        origin: ORIGIN,
        schema: payloadSchema,
      }),
    ).rejects.toMatchObject({ reason: 'rejected' })
    expect(upstream.calls).toHaveLength(0)
  })

  it('S8: the cache is bounded by retained bytes as well as by entry count', async () => {
    const releases = await Promise.all(
      ['a', 'b'].map(async (name) => ({
        name,
        release: await publishedRelease({ stations: [name.repeat(64)] }),
      })),
    )
    let clock = NOW
    const routes: Record<string, Array<() => Promise<Response>>> = {}
    for (const { name, release } of releases) {
      const base = `${ORIGIN}/${PRODUCT_ID}-${name}`
      routes[`${base}/current/manifest.json`] = [
        async () => json(release.manifestText),
        async () => json('', 500),
      ]
      routes[`${base}/releases/${RELEASE_ID}/${ARTIFACT_PATH}`] = [
        async () => json(release.artifactText),
      ]
    }
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      maxCacheBytes: 100,
      maxEntries: 8,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const productNamed = (name: string) =>
      productOf({ maxStaleMs: 60 * 60_000, productId: `${PRODUCT_ID}-${name}`, ttlMs: 1 })

    await client.read(productNamed('a'))
    await client.read(productNamed('b'))
    clock = NOW + 1_000

    // Two ~80-byte artifacts exceed the 100-byte ceiling, so the oldest is
    // evicted even though the entry count is well under maxEntries.
    await expect(client.read(productNamed('a'))).rejects.toMatchObject({ reason: 'http' })
    await expect(client.read(productNamed('b'))).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
  })

  it('S9: the manifest has a ceiling of its own, independent of the artifact', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(
      client.read(productOf({ manifestMaxBytes: 8, maxBytes: 16 * 1024 * 1024 })),
    ).rejects.toMatchObject({ reason: 'too-large' })
    expect(upstream.calls.filter((call) => call.url === artifactUrl)).toHaveLength(0)
  })

  it('N7: serving stale refreshes the entry, so it is not the next eviction', async () => {
    const releases = await Promise.all(
      ['a', 'b', 'c'].map(async (name) => ({
        name,
        release: await publishedRelease({ stations: [name] }),
      })),
    )
    let clock = NOW
    const routes: Record<string, Array<() => Promise<Response>>> = {}
    for (const { name, release } of releases) {
      const base = `${ORIGIN}/${PRODUCT_ID}-${name}`
      routes[`${base}/current/manifest.json`] = [
        async () => json(release.manifestText),
        async () => json('', 500),
      ]
      routes[`${base}/releases/${RELEASE_ID}/${ARTIFACT_PATH}`] = [
        async () => json(release.artifactText),
      ]
    }
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({
      failureCooldownMs: 0,
      fetch: upstream.fetch,
      maxEntries: 2,
      now: () => clock,
      origin: ORIGIN,
      retries: 0,
    })
    const productNamed = (name: string) =>
      productOf({ maxStaleMs: 60 * 60_000, productId: `${PRODUCT_ID}-${name}`, ttlMs: 1 })

    await client.read(productNamed('a'))
    await client.read(productNamed('b'))
    clock = NOW + 1_000
    // 'a' is the oldest entry until this stale serve moves it to the front.
    await expect(client.read(productNamed('a'))).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
    await client.read(productNamed('c'))

    await expect(client.read(productNamed('b'))).rejects.toMatchObject({ reason: 'http' })
    await expect(client.read(productNamed('a'))).resolves.toMatchObject({
      freshness: { source: STALE_IF_ERROR },
    })
  })

  it('surfaces a transport failure as a network error', async () => {
    const upstream = {
      calls: [] as FakeFetch['calls'],
      fetch: (async () => {
        throw new TypeError('connection reset')
      }) as unknown as typeof fetch,
    }
    const client = createNardukDataClient({
      fetch: upstream.fetch,
      now: () => NOW,
      origin: ORIGIN,
      retries: 0,
    })

    await expect(client.read(productOf())).rejects.toMatchObject({ reason: 'network' })
  })
})

describe('narduk-data client secondary entries', () => {
  const ENTRY_PATH = 'consumer/lakes/texas/canyon-lake/history-1y.json'
  const entryUrl = `${ORIGIN}/${PRODUCT_ID}/releases/${RELEASE_ID}/${ENTRY_PATH}`

  /** A release whose manifest also lists one nested secondary artifact. */
  async function releaseWithEntry(entryText: string, entrySha256?: string) {
    const release = await publishedRelease()
    const manifest = {
      ...release.manifest,
      artifacts: [
        release.manifest.artifact,
        { path: ENTRY_PATH, sha256: entrySha256 ?? (await sha256Hex(entryText)) },
      ],
    }
    return { manifestText: JSON.stringify(manifest) }
  }

  it('reads a listed nested entry and verifies it against its own checksum', async () => {
    const entryText = JSON.stringify({ stations: ['canyon'] })
    const { manifestText } = await releaseWithEntry(entryText)
    const upstream = fakeFetch({
      [entryUrl]: [async () => json(entryText)],
      [manifestUrl]: [async () => json(manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const result = await client.read(productOf({ entryPath: ENTRY_PATH }))

    expect(result.data).toEqual({ stations: ['canyon'] })
    expect(result.artifactUrl).toBe(entryUrl)
    expect(result.freshness.releaseId).toBe(RELEASE_ID)
    expect(upstream.calls.map((call) => call.url)).toEqual([manifestUrl, entryUrl])
  })

  it('keeps the primary artifact and each entry as separate cache entries', async () => {
    const entryText = JSON.stringify({ stations: ['canyon'] })
    const release = await publishedRelease()
    const { manifestText } = await releaseWithEntry(entryText)
    const upstream = fakeFetch({
      [artifactUrl]: [async () => json(release.artifactText)],
      [entryUrl]: [async () => json(entryText)],
      [manifestUrl]: [async () => json(manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const primary = await client.read(productOf())
    const entry = await client.read(productOf({ entryPath: ENTRY_PATH }))

    expect(primary.data).toEqual({ stations: ['41008'] })
    expect(entry.data).toEqual({ stations: ['canyon'] })
  })

  it('reports an unlisted entry as missing without fetching or falling back', async () => {
    const release = await publishedRelease()
    const upstream = fakeFetch({ [manifestUrl]: [async () => json(release.manifestText)] })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf({ entryPath: ENTRY_PATH }))).rejects.toMatchObject({
      reason: 'missing',
    })
    expect(upstream.calls.map((call) => call.url)).toEqual([manifestUrl])
  })

  it('rejects a manifest whose artifacts list is not a list', async () => {
    const release = await publishedRelease()
    const manifestText = JSON.stringify({
      ...release.manifest,
      artifacts: { path: ENTRY_PATH, sha256: 'a'.repeat(64) },
    })
    const upstream = fakeFetch({ [manifestUrl]: [async () => json(manifestText)] })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf({ entryPath: ENTRY_PATH }))).rejects.toMatchObject({
      reason: 'rejected',
    })
  })

  it('rejects an entry whose bytes do not match its listed checksum', async () => {
    const { manifestText } = await releaseWithEntry('{}', 'a'.repeat(64))
    const upstream = fakeFetch({
      [entryUrl]: [async () => json(JSON.stringify({ stations: [] }))],
      [manifestUrl]: [async () => json(manifestText)],
    })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf({ entryPath: ENTRY_PATH }))).rejects.toMatchObject({
      reason: 'checksum',
    })
  })

  it('rejects a listed entry that carries no usable checksum', async () => {
    const { manifestText } = await releaseWithEntry('{}', 'not-a-digest')
    const upstream = fakeFetch({ [manifestUrl]: [async () => json(manifestText)] })
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    await expect(client.read(productOf({ entryPath: ENTRY_PATH }))).rejects.toMatchObject({
      reason: 'rejected',
    })
  })

  it('never answers an unusable entry path from the memoised primary artifact', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })
    const product = productOf()

    await client.read(product)
    const callsAfterPrimary = upstream.calls.length

    await expect(client.read({ ...product, entryPath: '' })).rejects.toMatchObject({
      reason: 'rejected',
    })
    expect(upstream.calls).toHaveLength(callsAfterPrimary)
  })

  it.each(['../escape.json', 'a/../b.json', '/rooted.json', 'a//b.json', 'a/%2e%2e/b.json', ''])(
    'refuses the unsafe entry path %j before any request',
    async (entryPath) => {
      const upstream = fakeFetch({})
      const client = createNardukDataClient({
        fetch: upstream.fetch,
        now: () => NOW,
        origin: ORIGIN,
      })

      await expect(client.read(productOf({ entryPath }))).rejects.toMatchObject({
        reason: 'rejected',
      })
      expect(upstream.calls).toEqual([])
    },
  )
})
