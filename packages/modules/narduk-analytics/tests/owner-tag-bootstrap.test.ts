import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyOwnerTagCookies,
  loadOwnerPosthogBootstrap,
  OWNER_COOKIE_MAX_AGE_SECONDS,
  OWNER_FLAG_COOKIE,
  OWNER_PROOF_COOKIE,
  OWNER_PROOF_HOST_COOKIE,
  signOwnerProof,
  verifyOwnerProof,
} from '../server/utils/owner-tag-proof'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')

const OWNER_SECRET = 'test-owner-tag-secret'
const DISTINCT_ID = '11111111-2222-3333-4444-555555555555'

const enforceRateLimitPolicy = vi.hoisted(() => vi.fn())

vi.mock('#layer/server/utils/rateLimit', () => ({
  RATE_LIMIT_POLICIES: {
    ownerTag: { key: 'ownerTag', maxRequests: 60, namespace: 'owner-tag', windowMs: 60_000 },
  },
  enforceRateLimitPolicy,
}))

function makeEvent(cookieHeader = ''): H3Event {
  const responseHeaders = new Map<string, number | string | string[]>()
  const request = {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    method: 'GET',
    url: '/api/owner/posthog-bootstrap',
  } as IncomingMessage
  const response = {
    appendHeader(name: string, value: string) {
      const key = name.toLowerCase()
      const current = responseHeaders.get(key)
      responseHeaders.set(
        key,
        current === undefined
          ? value
          : Array.isArray(current)
            ? [...current, value]
            : [String(current), value],
      )
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase())
    },
    removeHeader(name: string) {
      responseHeaders.delete(name.toLowerCase())
    },
    setHeader(name: string, value: number | string | string[]) {
      responseHeaders.set(name.toLowerCase(), value)
    },
  } as unknown as ServerResponse
  return createEvent(request, response)
}

function setCookieHeaders(event: H3Event): string[] {
  const value = event.node.res.getHeader('set-cookie')
  if (!value) return []
  return Array.isArray(value) ? value.map(String) : [String(value)]
}

function cookieHeaderFromSetCookie(headers: string[]): string {
  return headers
    .filter((header) => !/max-age=0/i.test(header))
    .map((header) => header.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ')
}

describe('owner-tag proof cookies', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets a client-readable flag and an httpOnly HMAC proof', async () => {
    const event = makeEvent()

    await applyOwnerTagCookies(event, {
      enabled: true,
      secret: OWNER_SECRET,
      secure: false,
    })

    const headers = setCookieHeaders(event)
    const flag = headers.find((header) => header.startsWith(`${OWNER_FLAG_COOKIE}=`))
    const proof = headers.find(
      (header) => header.startsWith(`${OWNER_PROOF_COOKIE}=`) && !/max-age=0/i.test(header),
    )
    const liveHostProof = headers.find(
      (header) => header.startsWith(`${OWNER_PROOF_HOST_COOKIE}=`) && !/max-age=0/i.test(header),
    )

    expect(flag).toMatch(new RegExp(`^${OWNER_FLAG_COOKIE}=true;`))
    expect(flag).not.toMatch(/httponly/i)
    expect(flag).toMatch(/samesite=lax/i)
    expect(flag).toMatch(/path=\//i)

    const expectedProof = await signOwnerProof(OWNER_SECRET)
    expect(proof?.startsWith(`${OWNER_PROOF_COOKIE}=${expectedProof};`)).toBe(true)
    expect(proof).toMatch(/httponly/i)
    expect(proof).toMatch(/samesite=lax/i)
    expect(proof).toMatch(/path=\//i)
    expect(liveHostProof).toBeUndefined()
  })

  it('uses the __Host- proof name only when Secure is on', async () => {
    const event = makeEvent()

    await applyOwnerTagCookies(event, {
      enabled: true,
      secret: OWNER_SECRET,
      secure: true,
    })

    const headers = setCookieHeaders(event)
    const proof = headers.find((header) => header.startsWith(`${OWNER_PROOF_HOST_COOKIE}=`))
    const livePlainProof = headers.find(
      (header) => header.startsWith(`${OWNER_PROOF_COOKIE}=`) && !/max-age=0/i.test(header),
    )

    expect(proof).toMatch(/httponly/i)
    expect(proof).toMatch(/secure/i)
    expect(proof).toMatch(/path=\//i)
    expect(livePlainProof).toBeUndefined()
  })

  it('clears the flag and both proof cookie names when the tag is disabled', async () => {
    const event = makeEvent()

    await applyOwnerTagCookies(event, {
      enabled: false,
      secret: OWNER_SECRET,
      secure: true,
    })

    const headers = setCookieHeaders(event)
    expect(headers.some((header) => header.startsWith(`${OWNER_FLAG_COOKIE}=`))).toBe(true)
    expect(headers.some((header) => header.startsWith(`${OWNER_PROOF_COOKIE}=`))).toBe(true)
    expect(headers.some((header) => header.startsWith(`${OWNER_PROOF_HOST_COOKIE}=`))).toBe(true)
    expect(headers.every((header) => /max-age=0/i.test(header))).toBe(true)
  })
})

describe('GET /api/owner/posthog-bootstrap', () => {
  it('rejects a forged narduk_owner=true cookie without the signed proof', async () => {
    await expect(
      loadOwnerPosthogBootstrap(makeEvent(`${OWNER_FLAG_COOKIE}=true`), {
        ownerTagSecret: OWNER_SECRET,
        posthogOwnerDistinctId: DISTINCT_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a tampered proof signature', async () => {
    const proof = await signOwnerProof(OWNER_SECRET)
    const tampered = `${proof.slice(0, -1)}${proof.endsWith('a') ? 'b' : 'a'}`

    await expect(
      loadOwnerPosthogBootstrap(
        makeEvent(`${OWNER_FLAG_COOKIE}=true; ${OWNER_PROOF_COOKIE}=${tampered}`),
        {
          ownerTagSecret: OWNER_SECRET,
          posthogOwnerDistinctId: DISTINCT_ID,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns the distinct id after a valid owner-tag cookie pair', async () => {
    const tagged = makeEvent()
    await applyOwnerTagCookies(tagged, {
      enabled: true,
      secret: OWNER_SECRET,
      secure: false,
    })

    const result = await loadOwnerPosthogBootstrap(
      makeEvent(cookieHeaderFromSetCookie(setCookieHeaders(tagged))),
      {
        ownerTagSecret: OWNER_SECRET,
        posthogOwnerDistinctId: ` ${DISTINCT_ID} `,
      },
    )

    expect(result).toEqual({ distinctId: DISTINCT_ID })
  })

  it('still returns 501 when POSTHOG_OWNER_DISTINCT_ID is unset', async () => {
    const proof = await signOwnerProof(OWNER_SECRET)

    await expect(
      loadOwnerPosthogBootstrap(
        makeEvent(`${OWNER_FLAG_COOKIE}=true; ${OWNER_PROOF_COOKIE}=${proof}`),
        {
          ownerTagSecret: OWNER_SECRET,
          posthogOwnerDistinctId: '   ',
        },
      ),
    ).rejects.toMatchObject({ statusCode: 501 })
  })

  it('accepts the __Host- proof cookie minted for HTTPS', async () => {
    const proof = await signOwnerProof(OWNER_SECRET)

    await expect(
      loadOwnerPosthogBootstrap(
        makeEvent(`${OWNER_FLAG_COOKIE}=true; ${OWNER_PROOF_HOST_COOKIE}=${proof}`),
        {
          ownerTagSecret: OWNER_SECRET,
          posthogOwnerDistinctId: DISTINCT_ID,
        },
      ),
    ).resolves.toEqual({ distinctId: DISTINCT_ID })
  })

  it('issues a proof that carries an issued-at timestamp', async () => {
    const token = await signOwnerProof(OWNER_SECRET, 1_700_000_000_000)
    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/u)
    expect(token.startsWith('1700000000.')).toBe(true)
  })

  it('rejects a proof older than the server max age', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    try {
      const issuedAt = Date.now() - (OWNER_COOKIE_MAX_AGE_SECONDS + 120) * 1000
      const token = await signOwnerProof(OWNER_SECRET, issuedAt)
      await expect(
        loadOwnerPosthogBootstrap(
          makeEvent(`${OWNER_FLAG_COOKIE}=true; ${OWNER_PROOF_COOKIE}=${token}`),
          {
            ownerTagSecret: OWNER_SECRET,
            posthogOwnerDistinctId: DISTINCT_ID,
          },
        ),
      ).rejects.toMatchObject({ statusCode: 403 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects the previous static HMAC proof format', async () => {
    expect(await verifyOwnerProof(OWNER_SECRET, 'ab'.repeat(32))).toBe(false)
    await expect(
      loadOwnerPosthogBootstrap(
        makeEvent(`${OWNER_FLAG_COOKIE}=true; ${OWNER_PROOF_COOKIE}=${'ab'.repeat(32)}`),
        {
          ownerTagSecret: OWNER_SECRET,
          posthogOwnerDistinctId: DISTINCT_ID,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('owner bootstrap route wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    enforceRateLimitPolicy.mockReset()
    enforceRateLimitPolicy.mockResolvedValue(undefined)
    vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
    vi.stubGlobal('useRuntimeConfig', () => ({
      ownerTagSecret: OWNER_SECRET,
      posthogOwnerDistinctId: DISTINCT_ID,
    }))
  })

  it('rate-limits with RATE_LIMIT_POLICIES.ownerTag and enforces the HMAC gate', async () => {
    const source = readFileSync(
      join(packageRoot, 'server/api/owner/posthog-bootstrap.get.ts'),
      'utf8',
    )
    expect(source).toContain('enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.ownerTag)')
    expect(source).toContain('loadOwnerPosthogBootstrap')
    expect(source).not.toMatch(/getCookie\(event,\s*'narduk_owner'\)/)

    const handler = (await import('../server/api/owner/posthog-bootstrap.get')).default as (
      event: H3Event,
    ) => Promise<{ distinctId: string }>

    await expect(handler(makeEvent(`${OWNER_FLAG_COOKIE}=true`))).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(enforceRateLimitPolicy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ namespace: 'owner-tag' }),
    )

    const proof = await signOwnerProof(OWNER_SECRET)
    await expect(
      handler(makeEvent(`${OWNER_FLAG_COOKIE}=true; ${OWNER_PROOF_COOKIE}=${proof}`)),
    ).resolves.toEqual({ distinctId: DISTINCT_ID })

    vi.stubGlobal('useRuntimeConfig', () => ({
      ownerTagSecret: OWNER_SECRET,
      posthogOwnerDistinctId: '',
    }))
    await expect(
      handler(makeEvent(`${OWNER_FLAG_COOKIE}=true; ${OWNER_PROOF_COOKIE}=${proof}`)),
    ).rejects.toMatchObject({ statusCode: 501 })
  })

  it('keeps the PostHog plugin on the unsigned flag cookie', () => {
    const source = readFileSync(join(packageRoot, 'app/plugins/posthog.client.ts'), 'utf8')
    expect(source).toContain("document.cookie.includes('narduk_owner=true')")
  })
})
