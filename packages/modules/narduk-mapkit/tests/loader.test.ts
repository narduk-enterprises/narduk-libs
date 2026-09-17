/**
 * The v6 loader contract (narduk-libs#421 §d), driven against the deterministic
 * MapKit fake merged in narduk-libs#428 -- a real `load()` -> `init()` ->
 * `configuration-change` sequence, not a stub with an `init` spy.
 */
import {
  MapKitAuthError,
  fetchMapKitToken,
  initializeMapKit,
  mapKitErrorStatusForHttpStatus,
  parseMapKitOriginMismatch,
  resetMapKitClientStateForTests,
} from '../src/client/index.js'
import { createFakeMapKit } from '../src/testing/index.js'

import type { MapKitErrorStatus } from '../src/client/index.js'
import type { MapKit, MapKitConfigurationErrorEvent } from '@apple/mapkit-loader'
import type {
  FakeMapKitHandle,
  FakeMapKitLoadOptions,
  FakeMapKitOptions,
} from '../src/testing/index.js'

/**
 * Compile-time conformance: the hand-written `MapKitErrorStatus` union must be
 * exactly Apple's `ConfigurationErrorStatus`, which Apple's own `.d.ts` declares
 * but does not export. Either direction drifting fails `pnpm typecheck`.
 */
type AppleErrorStatus = MapKitConfigurationErrorEvent['status']
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _errorStatusIsApples: Exact<MapKitErrorStatus, AppleErrorStatus> = true
void _errorStatusIsApples

const LIBRARIES = ['map', 'annotations', 'overlays'] as const

interface Harness {
  fake: FakeMapKitHandle
  loadCalls: FakeMapKitLoadOptions[]
  loadImpl: (options: FakeMapKitLoadOptions) => Promise<MapKit>
}

function harness(options: FakeMapKitOptions = {}): Harness {
  const fake = createFakeMapKit(options)
  const loadCalls: FakeMapKitLoadOptions[] = []
  return {
    fake,
    loadCalls,
    loadImpl: async (loadOptions: FakeMapKitLoadOptions) => {
      loadCalls.push(loadOptions)
      return (await fake.load(loadOptions)) as unknown as MapKit
    },
  }
}

function tokenResponse(token = 'test.jwt.value', status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ expiresAt: Date.now() + 1_800_000, token }), {
      status,
    })) as unknown as typeof fetch
}

describe('initializeMapKit (narduk-libs#421 §d)', () => {
  afterEach(() => {
    resetMapKitClientStateForTests()
  })

  it('calls load() WITHOUT a token and passes the mandatory libraries', async () => {
    const { fake, loadCalls, loadImpl } = harness()

    await initializeMapKit({
      fetchImpl: tokenResponse(),
      libraries: LIBRARIES,
      loadImpl,
      nonce: 'nonce-123',
      tokenEndpoint: '/api/mapkit-token',
      version: '6',
    })

    expect(loadCalls).toHaveLength(1)
    // §d.1: a token on load() wires MapKit's static, non-refreshable path.
    expect(loadCalls[0]).not.toHaveProperty('token')
    expect(loadCalls[0]?.libraries).toStrictEqual(['map', 'annotations', 'overlays'])
    expect(loadCalls[0]?.nonce).toBe('nonce-123')
    expect(loadCalls[0]?.version).toBe('6')
    // The token arrived ONLY through init({ authorizationCallback }).
    expect(fake.inspect.tokenCalls).toBe(1)
    expect(fake.inspect.configurationChanges).toStrictEqual(['Initialized'])
  })

  it('refuses an empty libraries list', async () => {
    await expect(initializeMapKit({ libraries: [], loadImpl: harness().loadImpl })).rejects.toThrow(
      'libraries is required',
    )
  })

  it('resolves on Initialized and shares one singleton across call sites', async () => {
    const { fake, loadCalls, loadImpl } = harness()
    const options = { fetchImpl: tokenResponse(), libraries: LIBRARIES, loadImpl }

    const [first, second] = await Promise.all([
      initializeMapKit(options),
      initializeMapKit(options),
    ])

    expect(first).toBe(second)
    expect(loadCalls).toHaveLength(1)
    expect(fake.inspect.tokenCalls).toBe(1)
  })

  it('refuses a second initialization with different options', async () => {
    const { loadImpl } = harness()
    await initializeMapKit({ fetchImpl: tokenResponse(), libraries: LIBRARIES, loadImpl })

    await expect(
      initializeMapKit({ fetchImpl: tokenResponse(), libraries: ['map'], loadImpl }),
    ).rejects.toThrow('different options')
  })

  it('fetches the token with cache: no-store and never puts it in the URL', async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) })
      return new Response(JSON.stringify({ token: 'test.jwt.value' }))
    }) as unknown as typeof fetch

    await initializeMapKit({
      fetchImpl,
      libraries: LIBRARIES,
      loadImpl: harness().loadImpl,
      tokenEndpoint: '/api/mapkit-token',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/mapkit-token')
    expect(calls[0]?.init?.cache).toBe('no-store')
  })

  it('clears the singleton in the error handler so a caller can retry', async () => {
    // Apple's measured shape: the SAME token is re-sent three times, the
    // callback runs exactly once, then MapKit gives up for good (§d.4).
    const failing = harness({ auth: { mode: 'wrong-origin', expectedOrigin: 'http://a.test' } })

    const error = await initializeMapKit({
      fetchImpl: tokenResponse(),
      libraries: LIBRARIES,
      loadImpl: failing.loadImpl,
    }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(MapKitAuthError)
    expect((error as MapKitAuthError).status).toBe('Unauthorized')
    expect((error as MapKitAuthError).source).toBe('mapkit')
    expect((error as MapKitAuthError).originMismatch).toStrictEqual({
      actual: 'http://localhost:3000',
      expected: 'http://a.test',
    })
    expect(failing.fake.inspect.tokenCalls).toBe(1)
    expect(failing.fake.inspect.bootstrapAttempts).toHaveLength(3)
    expect(new Set(failing.fake.inspect.bootstrapAttempts.map((a) => a.tokenIndex)).size).toBe(1)

    // The singleton is gone: a retry runs a whole new exchange.
    const succeeding = harness()
    await expect(
      initializeMapKit({
        fetchImpl: tokenResponse(),
        libraries: LIBRARIES,
        loadImpl: succeeding.loadImpl,
      }),
    ).resolves.toBeDefined()
  })

  it('clears the singleton for an error that arrives AFTER init resolved', async () => {
    const { fake, loadImpl } = harness({
      auth: { onAccessKeyExpiry: 'error', status: 'Unauthorized' },
    })
    const failures: MapKitErrorStatus[] = []
    const options = {
      fetchImpl: tokenResponse(),
      libraries: LIBRARIES,
      loadImpl,
      onFailure: (failure: { status: MapKitErrorStatus }) => failures.push(failure.status),
    }

    const first = await initializeMapKit(options)
    expect(await initializeMapKit(options)).toBe(first)

    // 1800 s: the accessKey life Apple issues at bootstrap, on the fake's clock.
    fake.inspect.advanceClock(1_800_000)
    expect(failures).toStrictEqual(['Unauthorized'])

    // A retry re-runs load() rather than handing back the dead namespace.
    const retry = harness()
    await expect(
      initializeMapKit({
        fetchImpl: tokenResponse(),
        libraries: LIBRARIES,
        loadImpl: retry.loadImpl,
      }),
    ).resolves.toBeDefined()
    expect(retry.loadCalls).toHaveLength(1)
  })

  it('reports a Refreshed configuration change without re-resolving', async () => {
    const { fake, loadImpl } = harness({ auth: { onAccessKeyExpiry: 'refresh' } })
    const changes: string[] = []

    await initializeMapKit({
      fetchImpl: tokenResponse(),
      libraries: LIBRARIES,
      loadImpl,
      onConfigurationChange: (status) => changes.push(status),
    })

    fake.inspect.advanceClock(1_800_000)
    // The refresh token is fetched asynchronously, so the exchange lands a few
    // microtasks after the clock moves.
    await vi.waitFor(() => expect(fake.inspect.configurationChanges).toHaveLength(2))

    expect(changes).toStrictEqual(['Initialized', 'Refreshed'])
    expect(fake.inspect.tokenCalls).toBe(2)
  })

  it('never calls done("") when the token route refuses', async () => {
    const { fake, loadImpl } = harness()
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'not-same-origin' }), {
        status: 403,
      })) as unknown as typeof fetch

    const error = await initializeMapKit({
      fetchImpl,
      libraries: LIBRARIES,
      loadImpl,
    }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(MapKitAuthError)
    expect((error as MapKitAuthError).source).toBe('token')
    expect((error as MapKitAuthError).status).toBe('Unauthorized')
    expect((error as MapKitAuthError).httpStatus).toBe(403)
    // No exchange happened at all: an empty token would have produced a less
    // useful status than the real cause.
    expect(fake.inspect.tokens).toStrictEqual([])
    expect(fake.inspect.bootstrapAttempts).toStrictEqual([])
  })
})

describe('fetchMapKitToken failure mapping (§c.7)', () => {
  it.each([
    [403, 'Unauthorized'],
    [429, 'Too Many Requests'],
    [503, 'Unauthorized'],
    [405, 'Bad Request'],
    [418, 'Unknown'],
  ] as const)('maps HTTP %s onto Apple status %s', async (httpStatus, status) => {
    expect(mapKitErrorStatusForHttpStatus(httpStatus)).toBe(status)
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'refused' }), {
        status: httpStatus,
      })) as unknown as typeof fetch
    const error = await fetchMapKitToken('/api/mapkit-token', fetchImpl).catch(
      (reason: unknown) => reason,
    )
    expect((error as MapKitAuthError).status).toBe(status)
    expect((error as MapKitAuthError).httpStatus).toBe(httpStatus)
  })

  it('maps a fetch rejection onto Network Error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    await expect(fetchMapKitToken('/api/mapkit-token', fetchImpl)).rejects.toMatchObject({
      source: 'token',
      status: 'Network Error',
    })
  })

  it('maps a non-JSON body onto Malformed Response', async () => {
    const fetchImpl = (async () =>
      new Response('<!doctype html><title>login</title>')) as unknown as typeof fetch

    await expect(fetchMapKitToken('/api/mapkit-token', fetchImpl)).rejects.toMatchObject({
      status: 'Malformed Response',
    })
  })

  it('refuses a 200 that carries no token', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({}))) as unknown as typeof fetch

    await expect(fetchMapKitToken('/api/mapkit-token', fetchImpl)).rejects.toMatchObject({
      status: 'Malformed Response',
    })
  })
})

describe('parseMapKitOriginMismatch', () => {
  it("reads Apple's expected/actual diagnostic", () => {
    expect(
      parseMapKitOriginMismatch(
        'Origin does not match - expected: http://localhost:4501, actual: http://127.0.0.1:4502',
      ),
    ).toStrictEqual({
      actual: 'http://127.0.0.1:4502',
      expected: 'http://localhost:4501',
    })
  })

  it('returns undefined for any other message', () => {
    expect(parseMapKitOriginMismatch('Initialization failed.')).toBeUndefined()
  })
})
