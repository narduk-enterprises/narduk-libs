import { beforeAll, describe, expect, it } from 'vitest'

import { NotifyError } from '../src/errors'
import {
  DEFAULT_WEB_PUSH_HOSTS,
  generateVapidKeys,
  isAllowedPushEndpoint,
  sendWebPush,
  type VapidConfig,
  type WebPushMessage,
  type WebPushResult,
  type WebPushSubscription,
} from '../src/web-push'

import { verifyJwt } from './support/keys'
import { decryptWebPush, generateReceiver, type TestReceiver } from './support/web-push'

const NOW_MS = 1_800_000_000_000
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/token-1'

interface Captured {
  body: Uint8Array | undefined
  headers: Headers
  init: RequestInit
  url: string
}

let receiver: TestReceiver
let subscription: WebPushSubscription
let vapid: VapidConfig

beforeAll(async () => {
  receiver = await generateReceiver()
  subscription = { endpoint: ENDPOINT, keys: { p256dh: receiver.p256dh, auth: receiver.auth } }
  vapid = { subject: 'mailto:ops@nardukenterprises.com', ...(await generateVapidKeys()) }
})

function fakeFetch(respond: () => Response | Promise<Response>): {
  calls: Captured[]
  fetch: typeof fetch
} {
  const calls: Captured[] = []
  const impl = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      init: init ?? {},
      headers: new Headers(init?.headers),
      body: init?.body ? new Uint8Array(init.body as Uint8Array) : undefined,
    })
    return respond()
  }
  return { calls, fetch: impl as typeof fetch }
}

async function send(
  message: Partial<WebPushMessage>,
  response: () => Response | Promise<Response>,
  endpoint = ENDPOINT,
): Promise<{ calls: Captured[]; result: WebPushResult }> {
  const { calls, fetch } = fakeFetch(response)
  const result = await sendWebPush(
    { ...subscription, endpoint },
    { ttlSeconds: 60, ...message },
    vapid,
    { fetch, now: () => NOW_MS },
  )
  return { calls, result }
}

describe('sendWebPush request', () => {
  it('POSTs an encrypted body with TTL, encoding, urgency, topic and a VAPID Authorization', async () => {
    const { calls, result } = await send(
      {
        payload: JSON.stringify({ title: 'Drop' }),
        ttlSeconds: 3600,
        urgency: 'high',
        topic: 'drop_1-A',
      },
      () => new Response(null, { status: 201, headers: { Location: 'https://push.example/m/1' } }),
    )
    expect(result).toEqual({ ok: true, status: 201, location: 'https://push.example/m/1' })
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe(ENDPOINT)
    expect(call.init.method).toBe('POST')
    expect(call.init.redirect).toBe('manual')
    expect(call.headers.get('TTL')).toBe('3600')
    expect(call.headers.get('Content-Encoding')).toBe('aes128gcm')
    expect(call.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(call.headers.get('Urgency')).toBe('high')
    expect(call.headers.get('Topic')).toBe('drop_1-A')
    const decrypted = await decryptWebPush(call.body!, receiver)
    expect(new TextDecoder().decode(decrypted.plaintext)).toBe('{"title":"Drop"}')

    const match = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/u.exec(
      call.headers.get('Authorization') ?? '',
    )
    expect(match?.[2]).toBe(vapid.publicKey)
    const publicKey = await crypto.subtle.importKey(
      'raw',
      Buffer.from(vapid.publicKey, 'base64url'),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const jwt = await verifyJwt(match?.[1] ?? '', publicKey)
    expect(jwt.valid).toBe(true)
    expect(jwt.payload).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: vapid.subject })
  })

  it('sends a bare wake-up with Content-Length 0 and no Content-Encoding', async () => {
    const { calls, result } = await send({}, () => new Response(null, { status: 202 }))
    expect(result).toEqual({ ok: true, status: 202, location: null })
    const call = calls[0]!
    expect(call.body).toBeUndefined()
    expect(call.headers.get('Content-Length')).toBe('0')
    expect(call.headers.has('Content-Encoding')).toBe(false)
    expect(call.headers.has('Urgency')).toBe(false)
    expect(call.headers.has('Topic')).toBe(false)
  })

  it('accepts a Uint8Array payload and encodes strings as UTF-8', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const raw = await send({ payload: bytes }, () => new Response(null, { status: 201 }))
    expect((await decryptWebPush(raw.calls[0]!.body!, receiver)).plaintext).toEqual(bytes)
    const text = await send({ payload: 'Pokémon ⚡' }, () => new Response(null, { status: 201 }))
    expect(
      new TextDecoder().decode((await decryptWebPush(text.calls[0]!.body!, receiver)).plaintext),
    ).toBe('Pokémon ⚡')
  })

  it('refuses a payload over 3993 bytes without a request, and sends exactly 3993', async () => {
    const tooBig = await send(
      { payload: 'a'.repeat(3994) },
      () => new Response(null, { status: 201 }),
    )
    expect(tooBig.calls).toHaveLength(0)
    expect(tooBig.result).toEqual({
      ok: false,
      status: null,
      reason: 'payload_too_large',
      retryAfterSeconds: null,
    })
    // Counted in UTF-8 bytes, not characters.
    const wide = await send(
      { payload: 'é'.repeat(1997) },
      () => new Response(null, { status: 201 }),
    )
    expect(wide.calls).toHaveLength(0)
    const exact = await send(
      { payload: 'a'.repeat(3993) },
      () => new Response(null, { status: 201 }),
    )
    expect(exact.result.ok).toBe(true)
    expect(exact.calls[0]!.body).toHaveLength(4096)
  })

  it('shares one signature across parallel sends to an origin', async () => {
    const own: VapidConfig = {
      subject: 'mailto:parallel@nardukenterprises.com',
      ...(await generateVapidKeys()),
    }
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 201 }))
    await Promise.all(
      Array.from({ length: 5 }, (_, n) =>
        sendWebPush(
          { ...subscription, endpoint: `https://fcm.googleapis.com/fcm/send/${n}` },
          { ttlSeconds: 1 },
          own,
          { fetch, now: () => NOW_MS },
        ),
      ),
    )
    // ECDSA signatures are randomized: separate signings would differ.
    expect(new Set(calls.map((c) => c.headers.get('Authorization'))).size).toBe(1)
    expect(calls).toHaveLength(5)
  })

  it('signs once per origin and reuses the JWT until an hour before it expires', async () => {
    const keys = await generateVapidKeys()
    const own: VapidConfig = { subject: 'mailto:cache@nardukenterprises.com', ...keys }
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 201 }))
    let now = NOW_MS
    const sendAt = (endpoint: string): Promise<WebPushResult> =>
      sendWebPush({ ...subscription, endpoint }, { ttlSeconds: 1 }, own, { fetch, now: () => now })
    await sendAt(ENDPOINT)
    await sendAt(ENDPOINT)
    now += 10 * 3600 * 1000 // 2 h before the 12 h expiry: still cached
    await sendAt(ENDPOINT)
    await sendAt('https://web.push.apple.com/other')
    now += 1.5 * 3600 * 1000 // 30 min before expiry: re-signed
    await sendAt(ENDPOINT)
    const auth = calls.map((c) => c.headers.get('Authorization'))
    expect(auth[1]).toBe(auth[0])
    expect(auth[2]).toBe(auth[0])
    expect(auth[3]).not.toBe(auth[0])
    expect(auth[4]).not.toBe(auth[0])
  })
})

describe('sendWebPush status mapping', () => {
  it.each([
    [404, 'gone'],
    [410, 'gone'],
    [413, 'payload_too_large'],
    [400, 'bad_request'],
    [405, 'bad_request'],
    [301, 'bad_request'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
  ] as const)('maps %i to %s with no retry hint', async (status, reason) => {
    const { result } = await send({}, () => new Response(null, { status }))
    expect(result).toEqual({ ok: false, status, reason, retryAfterSeconds: null })
  })

  it('maps 429 and 5xx with Retry-After as seconds or an HTTP date', async () => {
    const seconds = await send(
      {},
      () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
    )
    expect(seconds.result).toEqual({
      ok: false,
      status: 429,
      reason: 'rate_limited',
      retryAfterSeconds: 120,
    })
    const date = await send(
      {},
      () =>
        new Response(null, {
          status: 503,
          headers: { 'Retry-After': new Date(NOW_MS + 90_000).toUTCString() },
        }),
    )
    expect(date.result).toEqual({
      ok: false,
      status: 503,
      reason: 'server_error',
      retryAfterSeconds: 90,
    })
    const past = await send(
      {},
      () =>
        new Response(null, {
          status: 500,
          headers: { 'Retry-After': new Date(NOW_MS - 5000).toUTCString() },
        }),
    )
    expect(past.result).toMatchObject({ reason: 'server_error', retryAfterSeconds: 0 })
    const junk = await send(
      {},
      () => new Response(null, { status: 429, headers: { 'Retry-After': 'soon' } }),
    )
    expect(junk.result).toMatchObject({ reason: 'rate_limited', retryAfterSeconds: null })
    const none = await send({}, () => new Response(null, { status: 502 }))
    expect(none.result).toMatchObject({ reason: 'server_error', retryAfterSeconds: null })
  })

  it('returns network_error when fetch throws, never rejecting', async () => {
    const { result } = await send({}, () => {
      throw new TypeError('fetch failed')
    })
    expect(result).toEqual({
      ok: false,
      status: null,
      reason: 'network_error',
      retryAfterSeconds: null,
    })
  })
})

describe('sendWebPush caller errors', () => {
  it.each([
    [{ ttlSeconds: -1 }],
    [{ ttlSeconds: 2_419_201 }],
    [{ ttlSeconds: 1.5 }],
    [{ ttlSeconds: Number.NaN }],
    [{ topic: 'a'.repeat(33) }],
    [{ topic: 'has space' }],
    [{ topic: '' }],
    [{ topic: 'a+b' }],
    [{ urgency: 'urgent' as 'high' }],
  ])('throws NotifyError for %j before any request', async (bad) => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 201 }))
    const error = await sendWebPush(subscription, { ttlSeconds: 60, ...bad }, vapid, {
      fetch,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotifyError)
    expect((error as NotifyError).code).toBe('invalid_notification')
    expect(calls).toHaveLength(0)
  })

  it('accepts the TTL bounds', async () => {
    for (const ttlSeconds of [0, 2_419_200]) {
      expect(
        (await send({ ttlSeconds }, () => new Response(null, { status: 201 }))).result.ok,
      ).toBe(true)
    }
  })

  it('throws for malformed subscription keys and VAPID keys', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 201 }))
    await expect(
      sendWebPush(
        { endpoint: ENDPOINT, keys: { p256dh: 'AAAA', auth: receiver.auth } },
        { ttlSeconds: 1, payload: 'x' },
        vapid,
        { fetch },
      ),
    ).rejects.toThrow(NotifyError)
    await expect(
      sendWebPush(subscription, { ttlSeconds: 1 }, { ...vapid, privateKey: 'AAAA' }, { fetch }),
    ).rejects.toThrow(NotifyError)
  })
})

describe('endpoint allowlist (SSRF guard)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://api.push.apple.com/3/device/abc',
    'https://FCM.GoogleAPIs.com/x',
    'https://fcm.googleapis.com:443/x',
  ])('allows %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true)
  })

  it.each([
    'http://fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://user@fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://2130706433/x',
    'https://[::1]/x',
    'https://[::ffff:7f00:1]/x',
    'https://localhost/x',
    'https://evil.example/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com/x',
    'https://notify.windows.com/x',
    'https://evilnotify.windows.com/x',
    'https://push.apple.com/x',
    'https://fcm.googleapis.com./x',
    'ftp://fcm.googleapis.com/x',
    'fcm.googleapis.com/x',
    '',
    'not a url',
  ])('refuses %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false)
  })

  it('lets the caller replace the allowlist, with exact and *. suffix entries only', () => {
    expect(isAllowedPushEndpoint('https://push.example.com/x', ['push.example.com'])).toBe(true)
    expect(isAllowedPushEndpoint('https://a.push.example.com/x', ['*.example.com'])).toBe(true)
    expect(isAllowedPushEndpoint('https://example.com/x', ['*.example.com'])).toBe(false)
    expect(isAllowedPushEndpoint('https://anything.example/x', ['*'])).toBe(false)
    expect(isAllowedPushEndpoint('https://anything.example/x', ['*.'])).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/x', ['push.example.com'])).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/x', [])).toBe(false)
    // An allowlist never lets an IP literal through.
    expect(isAllowedPushEndpoint('https://10.0.0.1/x', ['10.0.0.1'])).toBe(false)
  })

  it('lists the default push services', () => {
    expect(DEFAULT_WEB_PUSH_HOSTS).toEqual([
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
      '*.notify.windows.com',
      '*.push.apple.com',
    ])
  })

  it.each([
    'http://fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/x',
    'https://evil.example/x',
    'https://fcm.googleapis.com:8443/x',
    'https://u:p@fcm.googleapis.com/x',
  ])('sendWebPush refuses %s with no request', async (endpoint) => {
    const { calls, result } = await send(
      { payload: 'x' },
      () => new Response(null, { status: 201 }),
      endpoint,
    )
    expect(calls).toHaveLength(0)
    expect(result).toEqual({
      ok: false,
      status: null,
      reason: 'endpoint_not_allowed',
      retryAfterSeconds: null,
    })
  })

  it('sendWebPush honours allowedHosts', async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 201 }))
    const result = await sendWebPush(
      { ...subscription, endpoint: 'https://push.example.com/abc' },
      { ttlSeconds: 1 },
      vapid,
      { fetch, allowedHosts: ['push.example.com'] },
    )
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
