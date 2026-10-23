import { describe, expect, it } from 'vitest'

import {
  APNS_MAX_PAYLOAD_BYTES,
  buildApnsRequest,
  createApnsClient,
  createFetchApnsTransport,
} from '../src/apns'

import { ACTIVITY_TOKEN, DEVICE_TOKEN, generateTestApnsKey, verifyJwt } from './support/keys'

import type { ApnsRequest, ApnsTransportResponse } from '../src/apns'
import type { NotifyError } from '../src/errors'

const APNS_ID = '123e4567-e89b-12d3-a456-426614174000'
const BUNDLE = 'at.mybo.app'

describe('buildApnsRequest', () => {
  it('builds an alert push: path, topic, push type, priority and aps body', () => {
    const request = buildApnsRequest(
      {
        pushType: 'alert',
        alert: { title: 'Shore power lost', body: 'Tideye switched to inverter at 14:02' },
        sound: 'default',
        threadId: 'vessel-1',
        interruptionLevel: 'time-sensitive',
        data: { vesselId: 'vessel-1', alertId: 'a-1' },
      },
      {
        bundleId: BUNDLE,
        deviceToken: DEVICE_TOKEN.toUpperCase(),
        environment: 'production',
        apnsId: APNS_ID,
      },
      'jwt.token.sig',
    )
    expect(request).toEqual({
      method: 'POST',
      url: `https://api.push.apple.com/3/device/${DEVICE_TOKEN}`,
      headers: {
        authorization: 'bearer jwt.token.sig',
        'apns-id': APNS_ID,
        'apns-push-type': 'alert',
        'apns-topic': BUNDLE,
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        vesselId: 'vessel-1',
        alertId: 'a-1',
        aps: {
          alert: { title: 'Shore power lost', body: 'Tideye switched to inverter at 14:02' },
          sound: 'default',
          'thread-id': 'vessel-1',
          'interruption-level': 'time-sensitive',
        },
      }),
    })
  })

  it('builds a Live Activity update: liveactivity topic suffix, timestamp, event and content-state', () => {
    const request = buildApnsRequest(
      {
        pushType: 'liveactivity',
        event: 'update',
        contentState: { distanceMeters: 42, state: 'holding' },
        staleDate: 1_800_000_600,
      },
      {
        bundleId: BUNDLE,
        deviceToken: ACTIVITY_TOKEN,
        environment: 'development',
        apnsId: APNS_ID,
      },
      'jwt',
      1_800_000_000,
    )
    expect(request.url).toBe(`https://api.sandbox.push.apple.com/3/device/${ACTIVITY_TOKEN}`)
    expect(request.headers['apns-push-type']).toBe('liveactivity')
    expect(request.headers['apns-topic']).toBe(`${BUNDLE}.push-type.liveactivity`)
    expect(request.headers['apns-priority']).toBe('5')
    expect(JSON.parse(request.body)).toEqual({
      aps: {
        timestamp: 1_800_000_000,
        event: 'update',
        'content-state': { distanceMeters: 42, state: 'holding' },
        'stale-date': 1_800_000_600,
      },
    })
  })

  it('raises an alerting Live Activity (alarm fired) to priority 10, and ends one', () => {
    const alarm = buildApnsRequest(
      {
        pushType: 'liveactivity',
        event: 'update',
        contentState: { distanceMeters: 95, state: 'dragging' },
        alert: {
          title: 'Anchor alarm',
          body: 'Tideye is 95 m from the anchor',
          sound: 'alarm.caf',
        },
        relevanceScore: 100,
        timestamp: 1_800_000_100,
      },
      { bundleId: BUNDLE, deviceToken: ACTIVITY_TOKEN, environment: 'production' },
      'jwt',
    )
    expect(alarm.headers['apns-priority']).toBe('10')
    expect(JSON.parse(alarm.body).aps).toMatchObject({
      timestamp: 1_800_000_100,
      'relevance-score': 100,
      alert: { title: 'Anchor alarm', body: 'Tideye is 95 m from the anchor', sound: 'alarm.caf' },
    })

    const end = buildApnsRequest(
      { pushType: 'liveactivity', event: 'end', dismissalDate: 1_800_003_600 },
      { bundleId: BUNDLE, deviceToken: ACTIVITY_TOKEN, environment: 'production' },
      'jwt',
      1_800_000_000,
    )
    expect(JSON.parse(end.body)).toEqual({
      aps: { timestamp: 1_800_000_000, event: 'end', 'dismissal-date': 1_800_003_600 },
    })
  })

  it('builds push-to-start with attributes, and background pushes at priority 5', () => {
    const start = buildApnsRequest(
      {
        pushType: 'liveactivity',
        event: 'start',
        attributesType: 'AnchorWatchAttributes',
        attributes: { vesselName: 'Tideye' },
        contentState: { distanceMeters: 0, state: 'armed' },
        alert: { title: 'Anchor watch armed', body: 'Radius 40 m' },
      },
      { bundleId: BUNDLE, deviceToken: ACTIVITY_TOKEN, environment: 'production' },
      'jwt',
      1,
    )
    expect(JSON.parse(start.body).aps).toMatchObject({
      'attributes-type': 'AnchorWatchAttributes',
      attributes: { vesselName: 'Tideye' },
    })
    const background = buildApnsRequest(
      { pushType: 'background', data: { refresh: 'status' } },
      {
        bundleId: BUNDLE,
        deviceToken: DEVICE_TOKEN,
        environment: 'production',
        expiration: 0,
        collapseId: 'status',
      },
      'jwt',
    )
    expect(background.headers).toMatchObject({
      'apns-push-type': 'background',
      'apns-priority': '5',
      'apns-expiration': '0',
      'apns-collapse-id': 'status',
    })
    expect(JSON.parse(background.body)).toEqual({
      refresh: 'status',
      aps: { 'content-available': 1 },
    })
  })

  it.each([
    [{ pushType: 'liveactivity', event: 'update' }, /needs contentState/u],
    [
      { pushType: 'liveactivity', event: 'start', contentState: {} },
      /attributesType and attributes/u,
    ],
    [{ pushType: 'alert', alert: { title: ' ', body: 'b' } }, /title and body/u],
  ] as const)('refuses a malformed notification %#', (notification, message) => {
    expect(() =>
      buildApnsRequest(
        notification as never,
        { bundleId: BUNDLE, deviceToken: DEVICE_TOKEN, environment: 'production' },
        'jwt',
      ),
    ).toThrow(message)
  })

  it('refuses bad tokens, bundle ids, priorities, collapse ids and oversized payloads', () => {
    const alert = { pushType: 'alert', alert: { title: 't', body: 'b' } } as const
    const base = { bundleId: BUNDLE, deviceToken: DEVICE_TOKEN, environment: 'production' } as const
    const code = (fn: () => unknown): string => {
      try {
        fn()
      } catch (error) {
        return (error as NotifyError).code
      }
      return 'none'
    }
    expect(code(() => buildApnsRequest(alert, { ...base, deviceToken: 'xyz' }, 'jwt'))).toBe(
      'invalid_device_token',
    )
    expect(
      code(() => buildApnsRequest(alert, { ...base, deviceToken: 'ab'.repeat(10) }, 'jwt')),
    ).toBe('invalid_device_token')
    expect(code(() => buildApnsRequest(alert, { ...base, bundleId: ' ' }, 'jwt'))).toBe(
      'invalid_notification',
    )
    expect(code(() => buildApnsRequest(alert, { ...base, apnsId: 'nope' }, 'jwt'))).toBe(
      'invalid_notification',
    )
    expect(
      code(() => buildApnsRequest(alert, { ...base, collapseId: 'x'.repeat(65) }, 'jwt')),
    ).toBe('invalid_notification')
    expect(
      code(() =>
        buildApnsRequest({ pushType: 'background', data: {} }, { ...base, priority: 10 }, 'jwt'),
      ),
    ).toBe('invalid_notification')
    expect(
      code(() =>
        buildApnsRequest(
          { pushType: 'liveactivity', event: 'end' },
          { ...base, priority: 1 },
          'jwt',
        ),
      ),
    ).toBe('invalid_notification')
    expect(
      code(() =>
        buildApnsRequest(
          { ...alert, data: { blob: 'x'.repeat(APNS_MAX_PAYLOAD_BYTES) } },
          base,
          'jwt',
        ),
      ),
    ).toBe('payload_too_large')
  })
})

function scripted(responses: ApnsTransportResponse[]): {
  requests: ApnsRequest[]
  transport: (request: ApnsRequest) => Promise<ApnsTransportResponse>
} {
  const requests: ApnsRequest[] = []
  return {
    requests,
    transport: async (request) => {
      requests.push(request)
      const next = responses.shift()
      if (!next) throw new Error('no scripted response')
      return next
    },
  }
}

describe('createApnsClient', () => {
  it('sends with a verifiable provider token and reports the apns-id', async () => {
    const key = await generateTestApnsKey()
    const { requests, transport } = scripted([
      { status: 200, headers: { 'apns-id': APNS_ID }, body: '' },
    ])
    const client = createApnsClient({
      bundleId: BUNDLE,
      environment: 'production',
      credentials: { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: key.p8 },
      transport,
    })
    const result = await client.send(
      { pushType: 'alert', alert: { title: 't', body: 'b' } },
      { deviceToken: DEVICE_TOKEN, environment: 'development' },
    )
    expect(result).toEqual({
      ok: true,
      status: 200,
      apnsId: APNS_ID,
      reason: null,
      retryable: false,
      tokenInvalid: false,
    })
    expect(requests[0]?.url).toMatch(/^https:\/\/api\.sandbox\.push\.apple\.com\//u)
    const jwt = (requests[0]?.headers.authorization ?? '').replace(/^bearer /u, '')
    expect((await verifyJwt(jwt, key.publicKey)).valid).toBe(true)
  })

  it('re-signs once on ExpiredProviderToken, keeping the same apns-id', async () => {
    const key = await generateTestApnsKey()
    let now = 1_800_000_000_000
    const { requests, transport } = scripted([
      { status: 403, headers: {}, body: '{"reason":"ExpiredProviderToken"}' },
      { status: 200, headers: {}, body: '' },
    ])
    const client = createApnsClient({
      bundleId: BUNDLE,
      environment: 'production',
      credentials: { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: key.p8 },
      transport,
      now: () => {
        now += 1000
        return now
      },
    })
    const result = await client.send(
      { pushType: 'alert', alert: { title: 't', body: 'b' } },
      { deviceToken: DEVICE_TOKEN },
    )
    expect(result.ok).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.headers['apns-id']).toBe(requests[0]?.headers['apns-id'])
    expect(requests[1]?.headers.authorization).not.toBe(requests[0]?.headers.authorization)
  })

  it.each([
    [
      410,
      '{"reason":"Unregistered","timestamp":1800000000000}',
      { tokenInvalid: true, retryable: false, reason: 'Unregistered' },
    ],
    [
      400,
      '{"reason":"BadDeviceToken"}',
      { tokenInvalid: true, retryable: false, reason: 'BadDeviceToken' },
    ],
    [
      429,
      '{"reason":"TooManyRequests"}',
      { tokenInvalid: false, retryable: true, reason: 'TooManyRequests' },
    ],
    [503, 'not json', { tokenInvalid: false, retryable: true, reason: null }],
  ])('maps APNs %i to a result, never a throw', async (status, body, expected) => {
    const key = await generateTestApnsKey()
    const client = createApnsClient({
      bundleId: BUNDLE,
      environment: 'production',
      credentials: { teamId: 'T', keyId: 'K', privateKey: key.p8 },
      transport: scripted([{ status, headers: {}, body }]).transport,
    })
    const result = await client.send(
      { pushType: 'alert', alert: { title: 't', body: 'b' } },
      { deviceToken: DEVICE_TOKEN },
    )
    expect(result).toMatchObject({ ok: false, status, ...expected })
  })

  it('reports a transport failure as retryable', async () => {
    const key = await generateTestApnsKey()
    const client = createApnsClient({
      bundleId: BUNDLE,
      environment: 'production',
      credentials: { teamId: 'T', keyId: 'K', privateKey: key.p8 },
      transport: () => Promise.reject(new Error('socket hang up')),
    })
    const result = await client.send(
      { pushType: 'alert', alert: { title: 't', body: 'b' } },
      { deviceToken: DEVICE_TOKEN },
    )
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      reason: 'TransportError',
      retryable: true,
    })
  })

  it('adapts a fetch into a transport with lowercase headers', async () => {
    const seen: { init?: RequestInit; url?: string } = {}
    const transport = createFetchApnsTransport(async (url, init) => {
      seen.url = String(url)
      seen.init = init
      return new Response('{"reason":"BadTopic"}', { status: 400, headers: { 'APNS-ID': APNS_ID } })
    })
    const response = await transport({
      method: 'POST',
      url: 'https://x/3/device/a',
      headers: { a: 'b' },
      body: '{}',
    })
    expect(response).toEqual({
      status: 400,
      headers: { 'apns-id': APNS_ID, 'content-type': 'text/plain;charset=UTF-8' },
      body: '{"reason":"BadTopic"}',
    })
    expect(seen.init?.method).toBe('POST')
  })
})
