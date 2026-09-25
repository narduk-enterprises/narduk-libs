import { describe, expect, it, vi } from 'vitest'

import {
  READINESS_TEST_TITLE,
  assertHealthStatus,
  readHealthStatus,
  registerReadinessSetup,
  runReadinessChecks,
} from '../src/e2e/readiness.js'

import type { ReadinessContext, ReadinessRegistrar } from '../src/e2e/readiness.js'

const BASE = 'http://127.0.0.1:3000'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function context(fetchImpl: typeof fetch, calls: string[] = []): ReadinessContext {
  return {
    baseURL: BASE,
    browser: { newPage: vi.fn() } as unknown as ReadinessContext['browser'],
    fetch: fetchImpl,
    waitForBaseUrl: async (url) => {
      calls.push(`base ${url}`)
    },
    warmUp: async (_browser, _base, path) => {
      calls.push(`warm ${path}`)
    },
  }
}

describe('readHealthStatus', () => {
  it('reads the narduk-core envelope and a bare body', () => {
    expect(readHealthStatus({ success: true, data: { status: 'ok' } })).toBe('ok')
    expect(readHealthStatus({ status: 'degraded' })).toBe('degraded')
    expect(readHealthStatus(null)).toBeUndefined()
  })
})

describe('assertHealthStatus', () => {
  it('accepts degraded by default and rejects it when asked', () => {
    expect(() => assertHealthStatus({ data: { status: 'degraded' } })).not.toThrow()
    expect(() => assertHealthStatus({ data: { status: 'degraded' } }, false)).toThrow(
      /"degraded" is not 'ok'$/,
    )
    expect(() => assertHealthStatus({ data: { status: 'error' } })).toThrow(/'ok' or 'degraded'/)
  })
})

describe('runReadinessChecks', () => {
  it('waits for the base URL, passes health, then warms / by default', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(`health ${String(url)}`)
      return jsonResponse(200, { success: true, data: { status: 'degraded' } })
    }) as unknown as typeof fetch

    await runReadinessChecks(context(fetchImpl, calls))

    expect(calls).toEqual([`base ${BASE}`, `health ${BASE}/api/health`, 'warm /'])
  })

  it('retries a health route that is still compiling', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () =>
      ++n < 2 ? jsonResponse(503, {}) : jsonResponse(200, { data: { status: 'ok' } }),
    ) as unknown as typeof fetch

    await runReadinessChecks(context(fetchImpl), { timeoutMs: 5_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails with the last health reason once the deadline passes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: { status: 'error' } }),
    ) as unknown as typeof fetch

    await expect(runReadinessChecks(context(fetchImpl), { timeoutMs: 50 })).rejects.toThrow(
      /did not pass before the readiness deadline: health status "error"/,
    )
  })

  it('runs app assertions and reports what they threw', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: { status: 'ok', published: false } }),
    ) as unknown as typeof fetch
    const expectHealth = vi.fn((body: unknown) => {
      if (!(body as { data: { published: boolean } }).data.published) {
        throw new Error('publication not ready')
      }
    })

    await expect(
      runReadinessChecks(context(fetchImpl), { timeoutMs: 50, expectHealth }),
    ).rejects.toThrow(/publication not ready/)
    expect(expectHealth).toHaveBeenCalled()
  })

  it('rejects a non-JSON health body', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html></html>', { status: 200 }),
    ) as unknown as typeof fetch

    await expect(runReadinessChecks(context(fetchImpl), { timeoutMs: 50 })).rejects.toThrow(
      /did not answer JSON/,
    )
  })

  it('skips health when healthPath is false and warms every listed path in order', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn() as unknown as typeof fetch

    await runReadinessChecks(context(fetchImpl, calls), {
      healthPath: false,
      warmPaths: ['/', '/map', '/today'],
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(calls).toEqual([`base ${BASE}`, 'warm /', 'warm /map', 'warm /today'])
  })

  it('reads a custom health path relative to the base URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { status: 'ok' }),
    ) as unknown as typeof fetch

    await runReadinessChecks(context(fetchImpl), { healthPath: '/healthz', warmPaths: [] })
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/healthz`, expect.anything())
  })
})

describe('registerReadinessSetup', () => {
  function fakeRegistrar() {
    const registered: Array<{ title: string; body: Parameters<ReadinessRegistrar>[1] }> = []
    const setTimeout = vi.fn()
    const registrar = Object.assign(
      (title: string, body: Parameters<ReadinessRegistrar>[1]) => {
        registered.push({ title, body })
      },
      { setTimeout },
    ) as ReadinessRegistrar
    return { registered, registrar, setTimeout }
  }

  it('registers exactly one titled test', () => {
    const { registered, registrar } = fakeRegistrar()
    registerReadinessSetup({}, registrar)
    expect(registered.map((r) => r.title)).toEqual([READINESS_TEST_TITLE])
  })

  it('fails clearly when the config has no baseURL', async () => {
    const { registered, registrar, setTimeout } = fakeRegistrar()
    registerReadinessSetup({ timeoutMs: 1_000 }, registrar)
    await expect(registered[0]!.body({ baseURL: undefined, browser: {} as never })).rejects.toThrow(
      /use\.baseURL/,
    )
    expect(setTimeout).toHaveBeenCalledWith(1_000 + 90_000)
  })
})
