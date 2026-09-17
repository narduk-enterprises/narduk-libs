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
const PUBLISHED_AT = '2026-09-17T12:00:00.000Z'
const NOW = Date.parse('2026-09-17T12:10:00.000Z')

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
    staleness: { age_minutes: 10, newest_as_of: PUBLISHED_AT, state: 'current' },
  }
  return { artifactText, manifest, manifestText: JSON.stringify(manifest) }
}

interface FakeFetch {
  calls: Array<{ headers: Record<string, string>; method: string; url: string }>
  fetch: typeof fetch
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
    return responder()
  }) as unknown as typeof fetch
  return { calls, fetch: fetcher }
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
    freshness: { agingAfterMs: 30 * 60_000, staleAfterMs: 2 * 60 * 60_000 },
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
      publishedAgeMs: 600_000,
      publishedAt: PUBLISHED_AT,
      publishedState: 'current',
      releaseId: RELEASE_ID,
      source: 'upstream',
      stale: false,
      state: 'fresh',
    })
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
    expect(second.freshness.stale).toBe(false)
    expect(upstream.calls).toHaveLength(2)
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
    expect(stale.freshness).toMatchObject({
      ageMs: 5 * 60_000,
      source: 'stale-if-error',
      stale: true,
    })
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
      freshness: { source: 'stale-if-error' },
    })
    await expect(client.read(productNamed('c'))).resolves.toMatchObject({
      freshness: { source: 'stale-if-error' },
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
      publishedAgeMs: null,
      publishedAt: null,
      publishedState: null,
      state: 'unknown',
    })
  })

  it('reports unknown freshness when the product declares no thresholds', async () => {
    const { routes } = await successRoutes()
    const upstream = fakeFetch(routes)
    const client = createNardukDataClient({ fetch: upstream.fetch, now: () => NOW, origin: ORIGIN })

    const result = await client.read(productOf({ freshness: undefined }))

    expect(result.freshness.publishedAgeMs).toBe(600_000)
    expect(result.freshness.state).toBe('unknown')
  })

  it('derives aging and stale from the product thresholds', async () => {
    const { routes } = await successRoutes()
    const agingClient = createNardukDataClient({
      fetch: fakeFetch(routes).fetch,
      now: () => Date.parse(PUBLISHED_AT) + 45 * 60_000,
      origin: ORIGIN,
    })
    const staleClient = createNardukDataClient({
      fetch: fakeFetch(routes).fetch,
      now: () => Date.parse(PUBLISHED_AT) + 6 * 60 * 60_000,
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
