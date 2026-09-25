import { describe, expect, it } from 'vitest'

import { createNardukDataClient } from '../runtime/server/utils/narduk-data'

import type {
  NardukDataProduct,
  NardukDataSchema,
  NardukDataStore,
} from '../runtime/server/utils/narduk-data'

const ORIGIN = 'https://data.example.test'
const PRODUCT_ID = 'buoy-status-v1'
const ARTIFACT_PATH = 'public-buoy-data.json'
const RELEASE_ID = 'buoy-status-v1-20260917T120000Z-0123456789ab'
const START = Date.parse('2026-09-17T12:10:00.000Z')

const manifestUrl = `${ORIGIN}/${PRODUCT_ID}/current/manifest.json`
const artifactUrl = `${ORIGIN}/${PRODUCT_ID}/releases/${RELEASE_ID}/${ARTIFACT_PATH}`

interface Payload {
  stations: string[]
}

const payloadSchema: NardukDataSchema<Payload> = {
  safeParse: (value) =>
    typeof value === 'object' && value !== null && Array.isArray((value as Payload).stations)
      ? { data: value as Payload, success: true }
      : { error: 'nope', success: false },
}

const product: NardukDataProduct<Payload> = {
  productId: PRODUCT_ID,
  schema: payloadSchema,
  ttlMs: 30_000,
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function release(payload: Payload = { stations: ['41008'] }) {
  const artifactText = JSON.stringify(payload)
  const manifestText = JSON.stringify({
    artifact: { path: ARTIFACT_PATH, sha256: await sha256Hex(artifactText) },
    immutable: true,
    product_family_id: PRODUCT_ID,
    releaseId: RELEASE_ID,
  })
  return {
    artifactText,
    artifactKey: `${artifactUrl}?sha256=${await sha256Hex(artifactText)}`,
    manifestText,
  }
}

/** An origin that answers the two URLs and counts every request. */
function origin(manifestText: string, artifactText: string) {
  const calls: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url === manifestUrl) return new Response(manifestText)
    if (url === artifactUrl) return new Response(artifactText)
    throw new TypeError(`unexpected request: ${url}`)
  }) as typeof fetch
  return { calls, fetcher }
}

/** An in-memory Cache-API-shaped store; each `match` hands out a fresh body. */
function memoryStore() {
  const entries = new Map<string, { body: ArrayBuffer; headers: Headers }>()
  const store: NardukDataStore = {
    async delete(key) {
      return entries.delete(key)
    },
    async match(key) {
      const entry = entries.get(key)
      return entry ? new Response(entry.body.slice(0), { headers: entry.headers }) : undefined
    },
    async put(key, response) {
      entries.set(key, {
        body: await response.arrayBuffer(),
        headers: new Headers(response.headers),
      })
    },
  }
  return { entries, store }
}

function recordingWaitUntil() {
  const tasks: Array<Promise<unknown>> = []
  return {
    settle: () => Promise.all(tasks),
    tasks,
    waitUntil: (task: Promise<unknown>) => {
      tasks.push(task)
    },
  }
}

describe('narduk-data client store', () => {
  it('lets a cold isolate serve a stored release with no origin request', async () => {
    const { artifactText, manifestText } = await release()
    const { entries, store } = memoryStore()
    let clock = START
    const now = () => clock

    const warm = origin(manifestText, artifactText)
    const keep = recordingWaitUntil()
    const first = await createNardukDataClient({
      fetch: warm.fetcher,
      now,
      origin: ORIGIN,
      store,
    }).read(product, { waitUntil: keep.waitUntil })
    expect(first.freshness.source).toBe('upstream')
    // Both fills were handed to waitUntil, so the Worker keeps them alive.
    expect(keep.tasks).toHaveLength(2)
    await keep.settle()
    expect(entries.size).toBe(2)

    clock += 10_000
    const cold = origin(manifestText, artifactText)
    const second = await createNardukDataClient({
      fetch: cold.fetcher,
      now,
      origin: ORIGIN,
      store,
    }).read(product)
    expect(cold.calls).toEqual([])
    expect(second.data).toEqual({ stations: ['41008'] })
    expect(second.freshness.source).toBe('store')
    // The pair is as old as the stored manifest, not the time of this read.
    expect(second.freshness.fetchedAt).toBe(new Date(START).toISOString())
    expect(second.freshness.ageMs).toBe(10_000)
  })

  it('re-reads a stored manifest past its TTL but keeps the immutable artifact', async () => {
    const { artifactText, manifestText } = await release()
    const { store } = memoryStore()
    let clock = START
    const now = () => clock
    const keep = recordingWaitUntil()
    await createNardukDataClient({
      fetch: origin(manifestText, artifactText).fetcher,
      now,
      origin: ORIGIN,
      store,
    }).read(product, { waitUntil: keep.waitUntil })
    await keep.settle()

    clock += 30_000
    const cold = origin(manifestText, artifactText)
    const result = await createNardukDataClient({
      fetch: cold.fetcher,
      now,
      origin: ORIGIN,
      store,
    }).read(product)
    expect(cold.calls).toEqual([manifestUrl])
    expect(result.freshness.source).toBe('upstream')
    expect(result.freshness.fetchedAt).toBe(new Date(clock).toISOString())
  })

  it('never trusts a stored manifest without its own stored-at mark', async () => {
    const { artifactText, manifestText } = await release()
    const { entries, store } = memoryStore()
    entries.set(manifestUrl, {
      body: new TextEncoder().encode(manifestText).buffer as ArrayBuffer,
      headers: new Headers({ date: new Date(START).toUTCString() }),
    })
    const cold = origin(manifestText, artifactText)
    await createNardukDataClient({
      fetch: cold.fetcher,
      now: () => START,
      origin: ORIGIN,
      store,
    }).read(product)
    expect(cold.calls).toContain(manifestUrl)
  })

  it('evicts stored artifact bytes that fail the checksum and reads the origin', async () => {
    const { artifactKey, artifactText, manifestText } = await release()
    const { entries, store } = memoryStore()
    entries.set(artifactKey, {
      body: new TextEncoder().encode(JSON.stringify({ stations: ['tampered'] }))
        .buffer as ArrayBuffer,
      headers: new Headers(),
    })
    const cold = origin(manifestText, artifactText)
    const keep = recordingWaitUntil()
    const result = await createNardukDataClient({
      fetch: cold.fetcher,
      now: () => START,
      origin: ORIGIN,
      store,
    }).read(product, { waitUntil: keep.waitUntil })
    await keep.settle()
    expect(result.data).toEqual({ stations: ['41008'] })
    expect(cold.calls).toEqual([manifestUrl, artifactUrl])
    // The tampered copy was replaced by the verified download.
    const stored = entries.get(artifactKey)
    expect(stored && new TextDecoder().decode(stored.body)).toBe(artifactText)
  })

  it('fails open when the store throws on every call', async () => {
    const { artifactText, manifestText } = await release()
    const broken: NardukDataStore = {
      delete: () => Promise.reject(new Error('down')),
      match: () => Promise.reject(new Error('down')),
      put: () => Promise.reject(new Error('down')),
    }
    const cold = origin(manifestText, artifactText)
    const result = await createNardukDataClient({
      fetch: cold.fetcher,
      now: () => START,
      origin: ORIGIN,
      store: broken,
    }).read(product, {
      waitUntil: () => {
        throw new Error('outside a request context')
      },
    })
    expect(result.data).toEqual({ stations: ['41008'] })
    expect(result.freshness.source).toBe('upstream')
  })
})
