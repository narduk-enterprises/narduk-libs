import { describe, expect, it, vi } from 'vitest'

import {
  type LocationEnvironment,
  useCurrentLocation,
} from '../runtime/app/composables/useCurrentLocation'

// Outside a component there is nothing to mount; record the registration instead.
const mounted: Array<() => void> = []
vi.mock('vue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, onMounted: (hook: () => void) => mounted.push(hook) }
})

type Outcome =
  { position: { accuracy: number; latitude: number; longitude: number } } | { errorCode: 1 | 2 | 3 }

/** A browser whose one position read answers `outcome`. Records every call. */
function browser(
  outcome: Outcome,
  extra: Partial<LocationEnvironment> = {},
): {
  env: LocationEnvironment
  reads: PositionOptions[]
  watches: number
} {
  const reads: PositionOptions[] = []
  const record = { env: {} as LocationEnvironment, reads, watches: 0 }
  const geolocation = {
    getCurrentPosition: (
      success: PositionCallback,
      failure?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) => {
      reads.push(options ?? {})
      queueMicrotask(() => {
        if ('position' in outcome) {
          success({ coords: outcome.position, timestamp: 1_790_000_000_000 } as GeolocationPosition)
        } else failure?.({ code: outcome.errorCode, message: 'x' } as GeolocationPositionError)
      })
    },
    watchPosition: () => {
      record.watches += 1
      return 0
    },
  }
  record.env = { geolocation, ...extra }
  return record
}

const HERE = { latitude: 29.76, longitude: -95.37, accuracy: 120 }

describe('useCurrentLocation (narduk-libs#385)', () => {
  it('is a no-op with no browser: nothing thrown, nothing read, unavailable on request', async () => {
    const location = useCurrentLocation({}, () => ({}))
    expect(location.status.value).toBe('idle')
    expect(await location.refreshPermission()).toBe('unknown')
    expect(await location.locate()).toBeNull()
    expect(location.status.value).toBe('unavailable')
  })

  it('reads nothing until locate(), then reads exactly once and never watches', async () => {
    const fake = browser({ position: HERE })
    const location = useCurrentLocation({}, () => fake.env)
    expect(fake.reads).toHaveLength(0)

    const first = location.locate()
    expect(location.status.value).toBe('locating')
    // A second tap while the first read is in flight shares it.
    const second = location.locate()
    expect(await first).toMatchObject(HERE)
    expect(await second).toMatchObject(HERE)

    expect(fake.reads).toHaveLength(1)
    expect(fake.reads[0]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    })
    expect(fake.watches).toBe(0)
    expect(location.status.value).toBe('located')
    expect(location.permission.value).toBe('granted')
    expect(location.coords.value).toMatchObject({ ...HERE, timestamp: 1_790_000_000_000 })
  })

  it('keeps a refusal, no position and a timeout apart', async () => {
    for (const [errorCode, expected] of [
      [1, 'denied'],
      [2, 'unavailable'],
      [3, 'timeout'],
    ] as const) {
      const location = useCurrentLocation({}, () => browser({ errorCode }).env)
      expect(await location.locate()).toBeNull()
      expect(location.status.value).toBe(expected)
      expect(location.coords.value).toBeNull()
    }
  })

  it('reports a Permissions-Policy block as blocked, not as the person saying no', async () => {
    // Chromium answers PERMISSION_DENIED for a policy block too, so without the
    // policy check this would read as `denied`.
    const fake = browser(
      { errorCode: 1 },
      { policy: { allowsFeature: (feature) => feature !== 'geolocation' } },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const location = useCurrentLocation({}, () => fake.env)
      expect(await location.refreshPermission()).toBe('blocked')
      expect(await location.locate()).toBeNull()
      expect(location.status.value).toBe('blocked')
      expect(fake.reads).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('reads the permission without prompting, and survives a browser that rejects the query', async () => {
    const prompt = browser(
      { position: HERE },
      { permissions: { query: async () => ({ state: 'prompt' }) as PermissionStatus } },
    )
    const location = useCurrentLocation({}, () => prompt.env)
    expect(await location.refreshPermission()).toBe('prompt')
    expect(prompt.reads).toHaveLength(0)

    const rejecting = browser(
      { position: HERE },
      {
        permissions: {
          query: async () => {
            throw new TypeError('geolocation is not a valid permission name')
          },
        },
      },
    )
    expect(await useCurrentLocation({}, () => rejecting.env).refreshPermission()).toBe('unknown')
  })

  it('passes the caller options through to the one read', async () => {
    const fake = browser({ position: HERE })
    await useCurrentLocation(
      { enableHighAccuracy: true, timeoutMs: 2_000, maximumAgeMs: 0 },
      () => fake.env,
    ).locate()
    expect(fake.reads[0]).toEqual({ enableHighAccuracy: true, timeout: 2_000, maximumAge: 0 })
  })

  it('asks the browser nothing at setup, and only reads the permission once mounted', async () => {
    let queries = 0
    const fake = browser(
      { position: HERE },
      {
        permissions: {
          query: async () => {
            queries += 1
            return { state: 'granted' } as PermissionStatus
          },
        },
      },
    )
    mounted.length = 0
    const location = useCurrentLocation({}, () => fake.env)
    expect(queries).toBe(0)
    expect(location.permission.value).toBe('unknown')
    expect(mounted).toHaveLength(1)
    mounted[0]()
    await Promise.resolve()
    await Promise.resolve()
    expect(queries).toBe(1)
    expect(location.permission.value).toBe('granted')
    expect(fake.reads).toHaveLength(0)
  })
})
