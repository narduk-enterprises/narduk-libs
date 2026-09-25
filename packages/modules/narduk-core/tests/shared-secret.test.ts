/**
 * The shared-secret guard (narduk-libs#979): `requireCronAuth`'s constant-time
 * check, generalised to any secret key and header.
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  hasSharedSecret,
  requireSharedSecret,
  timingSafeEqualText,
} from '../runtime/server/utils/shared-secret'

import type { SharedSecretOptions } from '../runtime/server/utils/shared-secret'
import type { H3Event } from 'h3'

const SECRET = 'ingest-token-0123456789abcdef'

const { runtime } = vi.hoisted(() => ({ runtime: { recapIngestToken: '' } }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

function requestEvent(headers: Record<string, string> = {}): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.url = '/api/ingest'
  request.headers = headers
  return createEvent(request, new ServerResponse(request))
}

function ingestOptions(overrides: Partial<SharedSecretOptions> = {}): SharedSecretOptions {
  return { secretKey: 'RECAP_INGEST_TOKEN', fallback: runtime.recapIngestToken, ...overrides }
}

function statusOf(headers: Record<string, string>, overrides?: Partial<SharedSecretOptions>) {
  try {
    requireSharedSecret(requestEvent(headers), ingestOptions(overrides))
    return 200
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 0
  }
}

describe('timingSafeEqualText', () => {
  it('is true only for identical strings', () => {
    expect(timingSafeEqualText(SECRET, SECRET)).toBe(true)
    expect(timingSafeEqualText('', '')).toBe(true)
    expect(timingSafeEqualText(SECRET, `${SECRET.slice(0, -1)}X`)).toBe(false)
    expect(timingSafeEqualText(SECRET, SECRET.slice(0, 8))).toBe(false)
    expect(timingSafeEqualText(SECRET, `${SECRET}x`)).toBe(false)
    expect(timingSafeEqualText('', SECRET)).toBe(false)
  })

  it('compares UTF-8 bytes, not UTF-16 units', () => {
    expect(timingSafeEqualText('é'.repeat(4), 'e'.repeat(4))).toBe(false)
    expect(timingSafeEqualText('é', 'é')).toBe(true)
  })
})

describe('requireSharedSecret', () => {
  beforeEach(() => {
    vi.stubEnv('RECAP_INGEST_TOKEN', undefined)
    runtime.recapIngestToken = SECRET
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts the secret as a bearer token, any scheme case, or bare', () => {
    expect(statusOf({ authorization: `Bearer ${SECRET}` })).toBe(200)
    expect(statusOf({ authorization: `bearer   ${SECRET} ` })).toBe(200)
    expect(statusOf({ authorization: SECRET })).toBe(200)
  })

  it.each([
    ['a missing header', {}],
    ['an empty token', { authorization: 'Bearer ' }],
    ['a same-length wrong token', { authorization: `Bearer ${SECRET.slice(0, -1)}X` }],
    ['a prefix of the secret', { authorization: `Bearer ${SECRET.slice(0, 8)}` }],
  ])('rejects %s with 401', (_label, headers) => {
    expect(statusOf(headers)).toBe(401)
  })

  it('uses the configured reject status and message', () => {
    const event = requestEvent({ authorization: 'Bearer wrong' })
    expect(() =>
      requireSharedSecret(event, ingestOptions({ rejectStatus: 403, rejectMessage: 'No.' })),
    ).toThrow(expect.objectContaining({ statusCode: 403, message: 'No.' }))
  })

  it('reads a custom header raw, without stripping a scheme', () => {
    const header = 'x-scheduler-secret'
    expect(statusOf({ [header]: SECRET }, { header })).toBe(200)
    expect(statusOf({ [header]: `Bearer ${SECRET}` }, { header })).toBe(401)
    expect(statusOf({ authorization: `Bearer ${SECRET}` }, { header })).toBe(401)
  })

  it('prefers the runtime env binding over the runtimeConfig fallback', () => {
    vi.stubEnv('RECAP_INGEST_TOKEN', 'from-env')
    expect(statusOf({ authorization: 'Bearer from-env' })).toBe(200)
    expect(statusOf({ authorization: `Bearer ${SECRET}` })).toBe(401)
  })

  it('fails closed outside dev when the secret is unset, naming the key', () => {
    runtime.recapIngestToken = ''
    const event = requestEvent({ authorization: 'Bearer ' })
    expect(() => requireSharedSecret(event, ingestOptions())).toThrow(
      expect.objectContaining({
        statusCode: 500,
        message: 'RECAP_INGEST_TOKEN is not configured.',
      }),
    )
    expect(statusOf({}, { unsetStatus: 503 })).toBe(503)
  })
})

describe('hasSharedSecret', () => {
  beforeEach(() => {
    vi.stubEnv('RECAP_INGEST_TOKEN', undefined)
    runtime.recapIngestToken = SECRET
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('answers without throwing', () => {
    expect(
      hasSharedSecret(requestEvent({ authorization: `Bearer ${SECRET}` }), ingestOptions()),
    ).toBe(true)
    expect(hasSharedSecret(requestEvent({ authorization: 'Bearer wrong' }), ingestOptions())).toBe(
      false,
    )
    expect(hasSharedSecret(requestEvent(), ingestOptions())).toBe(false)
  })

  it('is false when the secret is unset, so a session fallback still runs', () => {
    runtime.recapIngestToken = ''
    expect(hasSharedSecret(requestEvent({ authorization: 'Bearer ' }), ingestOptions())).toBe(false)
    expect(hasSharedSecret(requestEvent(), ingestOptions())).toBe(false)
  })
})
