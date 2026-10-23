import { createServer, type Http2Server, type IncomingHttpHeaders } from 'node:http2'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApnsClient } from '../src/apns'
import { createNodeHttp2Transport } from '../src/node'

import { ACTIVITY_TOKEN, DEVICE_TOKEN, generateTestApnsKey, verifyJwt } from './support/keys'

import type { TestApnsKey } from './support/keys'

/**
 * A fixture APNs: an HTTP/2 server that checks what api.push.apple.com checks
 * before it accepts a notification (provider token, path, push type, topic,
 * priority, payload size and aps shape) and answers 200 with the apns-id or
 * 400 with APNs' own reason names. Every request is real HTTP/2 framing
 * through the package's Node transport.
 */
const BUNDLE = 'at.mybo.app'
const TEAM = 'TEAM123456'
const KID = 'KEY1234567'

interface Received {
  body: Record<string, unknown>
  headers: IncomingHttpHeaders
}

async function validate(
  headers: IncomingHttpHeaders,
  raw: string,
  key: TestApnsKey,
): Promise<string | null> {
  if (headers[':method'] !== 'POST') return 'MethodNotAllowed'
  const path = /^\/3\/device\/[0-9a-f]{64,200}$/u.exec(String(headers[':path']))
  if (!path) return 'BadPath'
  const auth = String(headers.authorization ?? '')
  if (!auth.startsWith('bearer ')) return 'MissingProviderToken'
  const jwt = await verifyJwt(auth.slice(7), key.publicKey)
  if (
    !jwt.valid ||
    jwt.header.alg !== 'ES256' ||
    jwt.header.kid !== KID ||
    jwt.payload.iss !== TEAM
  ) {
    return 'InvalidProviderToken'
  }
  const pushType = headers['apns-push-type']
  const topic = headers['apns-topic']
  if (
    pushType === 'liveactivity' ? topic !== `${BUNDLE}.push-type.liveactivity` : topic !== BUNDLE
  ) {
    return 'TopicDisallowed'
  }
  if (!['5', '10'].includes(String(headers['apns-priority']))) return 'BadPriority'
  if (Buffer.byteLength(raw) > 4096) return 'PayloadTooLarge'
  let body: { aps?: Record<string, unknown> }
  try {
    body = JSON.parse(raw) as typeof body
  } catch {
    return 'PayloadEmpty'
  }
  const aps = body.aps
  if (!aps) return 'PayloadEmpty'
  if (pushType === 'alert' && typeof aps.alert !== 'object') return 'BadAlert'
  if (pushType === 'liveactivity') {
    if (
      typeof aps.timestamp !== 'number' ||
      !['start', 'update', 'end'].includes(String(aps.event))
    ) {
      return 'BadLiveActivity'
    }
    if (aps.event !== 'end' && typeof aps['content-state'] !== 'object') return 'BadLiveActivity'
  }
  return null
}

describe('fixture app → HTTP/2 APNs fixture', () => {
  let server: Http2Server
  let origin: string
  let key: TestApnsKey
  const received: Received[] = []

  beforeAll(async () => {
    key = await generateTestApnsKey()
    server = createServer()
    server.on('stream', (stream, headers) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      const respond = async (): Promise<void> => {
        const raw = Buffer.concat(chunks).toString('utf8')
        const reason = await validate(headers, raw, key)
        const apnsId = String(headers['apns-id'] ?? '')
        if (reason) {
          stream.respond({ ':status': 400, 'apns-id': apnsId, 'content-type': 'application/json' })
          stream.end(JSON.stringify({ reason }))
          return
        }
        received.push({ headers, body: JSON.parse(raw) as Record<string, unknown> })
        stream.respond({ ':status': 200, 'apns-id': apnsId })
        stream.end()
      }
      stream.on('end', () => void respond())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('delivers an alert and a Live Activity update the fixture accepts, over one HTTP/2 session', async () => {
    const transport = createNodeHttp2Transport()
    const client = createApnsClient({
      bundleId: BUNDLE,
      environment: 'production',
      origin,
      credentials: { teamId: TEAM, keyId: KID, privateKey: key.p8 },
      transport: transport.send,
    })
    try {
      const alert = await client.send(
        {
          pushType: 'alert',
          alert: { title: 'Shore power lost', body: 'Tideye is on inverter' },
          sound: 'default',
        },
        { deviceToken: DEVICE_TOKEN },
      )
      const activity = await client.send(
        {
          pushType: 'liveactivity',
          event: 'update',
          contentState: { distanceMeters: 42, state: 'holding' },
        },
        { deviceToken: ACTIVITY_TOKEN },
      )
      expect(alert).toMatchObject({ ok: true, status: 200, reason: null })
      expect(activity).toMatchObject({ ok: true, status: 200, reason: null })
      expect(alert.apnsId).toMatch(/^[0-9a-f-]{36}$/u)

      expect(received.map(({ headers }) => headers['apns-push-type'])).toEqual([
        'alert',
        'liveactivity',
      ])
      expect(received[0]?.headers[':path']).toBe(`/3/device/${DEVICE_TOKEN}`)
      expect(received[1]?.headers[':path']).toBe(`/3/device/${ACTIVITY_TOKEN}`)
      expect(received[1]?.headers['apns-topic']).toBe(`${BUNDLE}.push-type.liveactivity`)
      expect(received[0]?.body).toEqual({
        aps: {
          alert: { title: 'Shore power lost', body: 'Tideye is on inverter' },
          sound: 'default',
        },
      })
      expect(received[1]?.body.aps).toMatchObject({
        event: 'update',
        'content-state': { distanceMeters: 42, state: 'holding' },
      })
    } finally {
      transport.close()
    }
  })

  it('surfaces the fixture rejecting a token signed by the wrong key', async () => {
    const wrong = await generateTestApnsKey()
    const transport = createNodeHttp2Transport()
    const client = createApnsClient({
      bundleId: BUNDLE,
      environment: 'production',
      origin,
      credentials: { teamId: TEAM, keyId: KID, privateKey: wrong.p8 },
      transport: transport.send,
    })
    try {
      const result = await client.send(
        { pushType: 'alert', alert: { title: 't', body: 'b' } },
        { deviceToken: DEVICE_TOKEN },
      )
      expect(result).toMatchObject({ ok: false, status: 400, reason: 'InvalidProviderToken' })
    } finally {
      transport.close()
    }
  })

  it('rejects when the server is unreachable', async () => {
    const transport = createNodeHttp2Transport({ timeoutMs: 2000 })
    try {
      await expect(
        transport.send({
          method: 'POST',
          url: 'http://127.0.0.1:1/3/device/x',
          headers: {},
          body: '{}',
        }),
      ).rejects.toThrow()
    } finally {
      transport.close()
    }
  })
})
