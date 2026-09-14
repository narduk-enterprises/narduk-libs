import { describe, expect, it } from 'vitest'
import { createLogger } from '../src/index.js'
import { createBoundedBuffer } from '../src/buffer.js'
import { createRemoteSink } from '../src/browser.js'
import { receiveClientLogs } from '../src/ingestion.js'
import { createMemorySink } from '../src/testing.js'

const options = { service: 'test', environment: 'test', runtime: 'browser' }
const record = {
  schemaVersion: 1 as const,
  timestamp: '2026-09-09T00:00:00.000Z',
  service: 'untrusted',
  environment: 'untrusted',
  runtime: 'browser',
  level: 'info' as const,
  message: 'Client event',
  data: { count: 1, unsafe: 'drop me', password: 'synthetic' },
}
const request = (records = [record], extra: RequestInit = {}) =>
  new Request('https://app.invalid/api/_narduk/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.invalid' },
    body: JSON.stringify({ schemaVersion: 1, records }),
    ...extra,
  })

describe('bounded delivery', () => {
  it('includes in-flight records in limits and exposes drops', async () => {
    let complete: (() => void) | undefined
    const buffer = createBoundedBuffer<number>({
      size: () => 10_000,
      send: () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
      shutdownMs: 10,
    })
    for (let i = 0; i < 100; i++) buffer.push(i)
    const pending = buffer.flush()
    await Promise.resolve()
    buffer.push(101)
    expect(buffer.stats.buffered).toBe(100)
    expect(buffer.stats.dropped).toBe(1)
    complete?.()
    await buffer.close()
    await pending
    expect(buffer.stats.buffered).toBe(0)
    expect(buffer.stats.bytes).toBe(0)
  })

  it('batches successful remote records and keeps the queue bounded by bytes', async () => {
    const batches: number[] = []
    const buffer = createBoundedBuffer<number>({
      size: () => 16000,
      async send(values) {
        batches.push(values.length)
      },
    })
    for (let i = 0; i < 100; i++) buffer.push(i)
    expect(buffer.stats.buffered).toBe(65)
    expect(buffer.stats.dropped).toBe(35)
    await buffer.close()
    expect(batches.every((length) => length <= 4)).toBe(true)
    expect(buffer.stats.delivered).toBe(65)
  })

  it('bounds retries and counts delivery failures without throwing into the app', async () => {
    const buffer = createBoundedBuffer<number>({
      size: () => 1,
      async send() {
        throw new Error('offline')
      },
    })
    buffer.push(1)
    await buffer.close()
    expect(buffer.stats.deliveryFailures).toBe(3)
    expect(buffer.stats.dropped).toBe(1)
  })

  it('sends only sanitized records to a same-origin app endpoint', async () => {
    const bodies: string[] = []
    const sink = createRemoteSink({
      endpoint: '/api/_narduk/logs',
      fetch: async (_url, init) => {
        bodies.push(String(init?.body))
        expect(init?.credentials).toBe('same-origin')
        return new Response(null, { status: 202 })
      },
    })
    const log = createLogger({ ...options, sinks: [sink] })
    log.error('Synthetic', { password: 'synthetic' })
    await log.close()
    expect(bodies[0]).not.toContain('"password":"synthetic"')
    expect(sink.stats.delivered).toBe(1)
    expect(() => createRemoteSink({ endpoint: 'https://collector.invalid' })).toThrow('same-origin')
    expect(() => createRemoteSink({ endpoint: '//collector.invalid' })).toThrow('same-origin')
  })
})

describe('client ingestion', () => {
  const setup = () => {
    const sink = createMemorySink()
    const logger = createLogger({
      service: 'trusted-app',
      environment: 'production',
      runtime: 'worker',
      sinks: [sink],
    })
    return {
      sink,
      options: {
        logger,
        authorize: () => true,
        rateLimit: () => true,
        allowedDataFields: ['count', 'password'],
      },
    }
  }

  it('uses server identity and a strict field allowlist', async () => {
    const { sink, options: config } = setup()
    expect((await receiveClientLogs(request(), config)).status).toBe(202)
    expect(sink.records[0]).toMatchObject({
      service: 'trusted-app',
      environment: 'production',
      source: 'client',
      data: { count: 1, password: '[REDACTED]' },
    })
    expect(sink.records[0]?.data).not.toHaveProperty('unsafe')
  })

  it('rejects unauthenticated, foreign-origin, oversized, invalid, and rate-limited input', async () => {
    const { sink, options: config } = setup()
    expect((await receiveClientLogs(request(), { ...config, authorize: () => false })).status).toBe(
      401,
    )
    expect((await receiveClientLogs(request(), { ...config, rateLimit: () => false })).status).toBe(
      429,
    )
    expect(
      (
        await receiveClientLogs(
          request([record], {
            headers: { 'content-type': 'application/json', origin: 'https://foreign.invalid' },
          }),
          config,
        )
      ).status,
    ).toBe(403)
    expect(
      (await receiveClientLogs(request([record], { body: 'x'.repeat(65537) }), config)).status,
    ).toBe(413)
    expect((await receiveClientLogs(request([record], { body: '{broken' }), config)).status).toBe(
      400,
    )
    expect(
      (await receiveClientLogs(request(Array.from({ length: 11 }, () => record)), config)).status,
    ).toBe(400)
    expect(sink.records).toHaveLength(0)
  })

  it('requires explicit origins even in anonymous mode', async () => {
    const { options: config } = setup()
    const anonymous = { ...config, mode: 'anonymous' as const, authorize: () => false }
    expect((await receiveClientLogs(request(), anonymous)).status).toBe(403)
    expect(
      (
        await receiveClientLogs(request(), {
          ...anonymous,
          allowedOrigins: ['https://app.invalid'],
        })
      ).status,
    ).toBe(202)
    expect(
      (
        await receiveClientLogs(
          request([record], { headers: { 'content-type': 'application/json' } }),
          { ...anonymous, allowedOrigins: ['https://app.invalid'] },
        )
      ).status,
    ).toBe(403)
  })

  it('rejects deeply nested JSON and oversized individual records before recursive validation', async () => {
    const { sink, options: config } = setup()
    const nested =
      '{"schemaVersion":1,"records":[' + '['.repeat(12000) + '0' + ']'.repeat(12000) + ']}'
    expect((await receiveClientLogs(request([], { body: nested }), config)).status).toBe(400)
    expect(
      (
        await receiveClientLogs(
          request([{ ...record, data: { ...record.data, unsafe: 'x'.repeat(17000) } }]),
          config,
        )
      ).status,
    ).toBe(400)
    expect(sink.records).toHaveLength(0)
  })
})
