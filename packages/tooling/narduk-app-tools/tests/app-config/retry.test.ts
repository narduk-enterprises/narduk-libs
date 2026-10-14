import { describe, expect, it } from 'vitest'

import {
  APP_CONFIG_BACKOFF_MS,
  APP_CONFIG_DEFAULT_TIMEOUT_MS,
  APP_CONFIG_MAX_ATTEMPTS,
  AppConfigError,
  fetchPortalAppConfig,
  type AppConfigFetch,
  type AppConfigFetchResponse,
} from '../../src/app-config/resolve.js'
import { TOKEN } from './fake-portal.js'

const REPO = 'example/app'
const REQUEST_TOKEN = 'actions-request-token-0123456789'
const MINTED = 'eyJhbGciOiJSUzI1NiJ9.eyJyZXBvc2l0b3J5IjoiZXhhbXBsZS9hcHAifQ.c2lnbmF0dXJl'
const DOC = JSON.stringify({ contractOwnership: 'portal-owned', worker: { name: 'app' } })

type Step = number | Error | 'hang' | { status: 200; body: string }

const reply = (status: number, body = ''): AppConfigFetchResponse => ({
  status,
  headers: { get: () => null },
  text: async () => body,
})

/** A fetch that plays `steps` in order, one per call, to the matching hop. */
function script(portal: Step[], oidc: Step[] = []) {
  const calls = { portal: 0, oidc: 0 }
  const play = (step: Step | undefined, init: { signal: AbortSignal }, okBody: string) => {
    if (step === undefined) throw new Error('script exhausted')
    if (step === 'hang') {
      return new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    if (step instanceof Error) return Promise.reject(step)
    if (typeof step === 'object') return Promise.resolve(reply(200, step.body))
    return Promise.resolve(reply(step, step === 200 ? okBody : ''))
  }
  const fetch: AppConfigFetch = (url, init) => {
    if (new URL(url).pathname === '/api/estate/app-config') {
      return play(portal[calls.portal++], init, DOC)
    }
    return play(oidc[calls.oidc++], init, JSON.stringify({ value: MINTED }))
  }
  return { fetch, calls }
}

function clock() {
  const waits: number[] = []
  return { waits, sleep: async (ms: number) => void waits.push(ms), random: () => 0.5 }
}

const tokenEnv: NodeJS.ProcessEnv = { OPERATOR_PORTAL_APP_CONFIG_TOKEN: TOKEN }
const oidcEnv: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: 'true',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.example.test/idtoken?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN,
}

function run(
  env: NodeJS.ProcessEnv,
  steps: ReturnType<typeof script>,
  time: ReturnType<typeof clock>,
  extra: { timeoutMs?: number; maxAttempts?: number } = {},
) {
  return fetchPortalAppConfig(REPO, 'cloudflare-app.json', {
    env,
    fetch: steps.fetch,
    sleep: time.sleep,
    random: time.random,
    ...extra,
  })
}

const failure = async (promise: Promise<unknown>): Promise<AppConfigError> => {
  const error = await promise.then(
    () => new Error('resolved, but a failure was expected'),
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(AppConfigError)
  return error as AppConfigError
}

describe('the retry budget', () => {
  it('is 3 attempts of 10 s with 1 s then 3 s of backoff: under 45 s in the worst case', () => {
    expect(APP_CONFIG_MAX_ATTEMPTS).toBe(3)
    expect(APP_CONFIG_DEFAULT_TIMEOUT_MS).toBe(10_000)
    expect(APP_CONFIG_BACKOFF_MS).toEqual([1000, 3000])
    const worst =
      APP_CONFIG_MAX_ATTEMPTS * APP_CONFIG_DEFAULT_TIMEOUT_MS +
      APP_CONFIG_BACKOFF_MS.reduce((a, b) => a + b, 0) * 1.25
    expect(worst).toBeLessThan(45_000)
  })
})

describe('portal outages are retried', () => {
  it('a timeout then success returns the document after one backoff', async () => {
    const steps = script(['hang', 200])
    const time = clock()
    const result = await run(tokenEnv, steps, time, { timeoutMs: 20 })
    expect(result?.source).toBe('portal')
    expect(steps.calls.portal).toBe(2)
    expect(time.waits).toEqual([1000])
  })

  it('a network error then success', async () => {
    const steps = script([new Error('ECONNRESET'), 200])
    const time = clock()
    expect((await run(tokenEnv, steps, time))?.source).toBe('portal')
    expect(steps.calls.portal).toBe(2)
  })

  it.each([429, 502, 503, 504])('HTTP %i then success', async (status) => {
    const steps = script([status, 200])
    const time = clock()
    expect((await run(tokenEnv, steps, time))?.source).toBe('portal')
    expect(steps.calls.portal).toBe(2)
    expect(time.waits).toEqual([1000])
  })

  it('backs off 1 s then 3 s, jittered within 25 percent', async () => {
    for (const [random, first, second] of [
      [0, 750, 2250],
      [0.5, 1000, 3000],
      [0.999, 1250, 3750],
    ] as const) {
      const steps = script([503, 503, 200])
      const waits: number[] = []
      await fetchPortalAppConfig(REPO, 'cloudflare-app.json', {
        env: tokenEnv,
        fetch: steps.fetch,
        sleep: async (ms) => void waits.push(ms),
        random: () => random,
      })
      expect(waits[0]).toBeGreaterThanOrEqual(first - 1)
      expect(waits[0]).toBeLessThanOrEqual(first + 1)
      expect(waits[1]).toBeGreaterThanOrEqual(second - 2)
      expect(waits[1]).toBeLessThanOrEqual(second + 2)
    }
  })

  it('503 three times fails loudly and says how many attempts were made', async () => {
    const steps = script([503, 503, 503, 200])
    const time = clock()
    const error = await failure(run(tokenEnv, steps, time))
    expect(error.code).toBe('unavailable')
    expect(error.status).toBe(503)
    expect(error.attempts).toBe(3)
    expect(error.message).toContain('3 attempts made')
    expect(steps.calls.portal).toBe(3)
    expect(time.waits).toHaveLength(2)
  })

  it('timeouts three times fail as a timeout with the count', async () => {
    const steps = script(['hang', 'hang', 'hang', 200])
    const error = await failure(run(tokenEnv, steps, clock(), { timeoutMs: 10 }))
    expect(error.code).toBe('timeout')
    expect(error.attempts).toBe(3)
    expect(error.message).toContain('within 10 ms')
    expect(error.message).toContain('3 attempts made')
  })

  it('maxAttempts bounds the tries', async () => {
    const steps = script([503, 503, 503])
    const error = await failure(run(tokenEnv, steps, clock(), { maxAttempts: 2 }))
    expect(error.attempts).toBe(2)
    expect(steps.calls.portal).toBe(2)
  })
})

describe('answers are never retried', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [400, 'bad-response'],
    [409, 'bad-response'],
    [500, 'bad-response'],
  ] as const)('HTTP %i fails once with the existing message', async (status, code) => {
    const steps = script([status, 200])
    const time = clock()
    const error = await failure(run(tokenEnv, steps, time))
    expect(error.code).toBe(code)
    expect(error.status).toBe(status)
    expect(error.attempts).toBeUndefined()
    expect(error.message).not.toContain('attempt')
    expect(steps.calls.portal).toBe(1)
    expect(time.waits).toEqual([])
  })

  it('HTTP 404 is one request and an absence', async () => {
    const steps = script([404, 200])
    const time = clock()
    await expect(run(tokenEnv, steps, time)).resolves.toBeNull()
    expect(steps.calls.portal).toBe(1)
    expect(time.waits).toEqual([])
  })

  it('a malformed body fails once', async () => {
    const steps = script([{ status: 200, body: '{not json' }, 200])
    const error = await failure(run(tokenEnv, steps, clock()))
    expect(error.code).toBe('bad-response')
    expect(steps.calls.portal).toBe(1)
  })

  it('a failure after a retry still reports the attempts it took', async () => {
    const error = await failure(run(tokenEnv, script([503, 401]), clock()))
    expect(error.code).toBe('unauthorized')
    expect(error.attempts).toBe(2)
    expect(error.message).toContain('2 attempts made')
  })
})

describe('secrets stay out of every message', () => {
  it('a leaking network error is scrubbed on every attempt and in the final message', async () => {
    const leak = () => new Error(`reset while sending Bearer ${TOKEN}`)
    const error = await failure(run(tokenEnv, script([leak(), leak(), leak()]), clock()))
    expect(error.code).toBe('network')
    expect(error.attempts).toBe(3)
    expect(error.message).toContain('3 attempts made')
    expect(error.message).not.toContain(TOKEN)
  })

  it('neither OIDC token appears after retries on either hop', async () => {
    const leak = () => new Error(`failed with Bearer ${MINTED} and ${REQUEST_TOKEN}`)
    const portalHop = await failure(run(oidcEnv, script([leak(), leak(), leak()], [200]), clock()))
    expect(portalHop.code).toBe('network')
    expect(portalHop.message).not.toContain(MINTED)
    expect(portalHop.message).not.toContain(REQUEST_TOKEN)

    const oidcHop = await failure(run(oidcEnv, script([], [leak(), leak(), leak()]), clock()))
    expect(oidcHop.code).toBe('oidc')
    expect(oidcHop.attempts).toBe(3)
    expect(oidcHop.message).not.toContain(MINTED)
    expect(oidcHop.message).not.toContain(REQUEST_TOKEN)
  })
})

describe('the OIDC token request is retried the same way', () => {
  it.each([429, 502, 503, 504])('HTTP %i from GitHub then success', async (status) => {
    const steps = script([200], [status, 200])
    const time = clock()
    expect((await run(oidcEnv, steps, time))?.source).toBe('portal')
    expect(steps.calls.oidc).toBe(2)
    expect(steps.calls.portal).toBe(1)
    expect(time.waits).toEqual([1000])
  })

  it('a GitHub timeout then success', async () => {
    const steps = script([200], ['hang', 200])
    expect((await run(oidcEnv, steps, clock(), { timeoutMs: 20 }))?.source).toBe('portal')
    expect(steps.calls.oidc).toBe(2)
  })

  it('a GitHub network error then success', async () => {
    const steps = script([200], [new Error('socket hang up'), 200])
    expect((await run(oidcEnv, steps, clock()))?.source).toBe('portal')
    expect(steps.calls.oidc).toBe(2)
  })

  it('503 from GitHub three times fails as oidc with the count', async () => {
    const steps = script([200], [503, 503, 503])
    const error = await failure(run(oidcEnv, steps, clock()))
    expect(error.code).toBe('oidc')
    expect(error.attempts).toBe(3)
    expect(error.message).toContain('HTTP 503')
    expect(error.message).toContain('3 attempts made')
    expect(steps.calls.portal).toBe(0)
  })

  it('a refused (403) or malformed OIDC answer fails once', async () => {
    for (const oidc of [
      [403, 200],
      [{ status: 200, body: 'nope' } as const, 200],
      [404, 200],
    ]) {
      const steps = script([200], oidc as Step[])
      const time = clock()
      const error = await failure(run(oidcEnv, steps, time))
      expect(error.code).toBe('oidc')
      expect(error.attempts).toBeUndefined()
      expect(steps.calls.oidc).toBe(1)
      expect(time.waits).toEqual([])
    }
  })

  it('keeps the minted token when only the portal hop is retried', async () => {
    const steps = script([503, 200], [200])
    expect((await run(oidcEnv, steps, clock()))?.source).toBe('portal')
    expect(steps.calls.oidc).toBe(1)
    expect(steps.calls.portal).toBe(2)
  })
})
