import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createLogger,
  privateValue,
  sanitizeErrorForLog,
  sanitizeFields,
  sanitizeUrlForLog,
} from '../src/index.js'
import { createMemorySink } from '../src/testing.js'
import { logRecordSchema } from '../src/schema.js'
import { MAX_RECORD_BYTES, recordBytes } from '../src/sanitize.js'
import type { LogRecord } from '../src/index.js'

const fixtureSchema = z.array(
  z.object({
    name: z.string(),
    input: z.record(z.string(), z.json()),
    expected: z.record(z.string(), z.json()),
  }),
)
const fixtures = fixtureSchema.parse(
  JSON.parse(readFileSync(new URL('../schema/fixtures.json', import.meta.url), 'utf8')),
)
const options = {
  service: 'fixture',
  environment: 'production',
  runtime: 'test',
  clock: () => new Date('2026-09-09T00:00:00.000Z'),
}

describe('cross-language contract', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => expect(sanitizeFields(fixture.input)).toEqual(fixture.expected))
  }

  it('emits the canonical record and does not collapse repeated events', () => {
    const sink = createMemorySink()
    const log = createLogger({ ...options, sinks: [sink] })
    for (let i = 0; i < 12; i++) log.info('Ready', { count: 1 })
    expect(sink.records).toHaveLength(12)
    expect(sink.records[0]).toEqual({
      schemaVersion: 1,
      timestamp: '2026-09-09T00:00:00.000Z',
      level: 'info',
      message: 'Ready',
      service: 'fixture',
      environment: 'production',
      runtime: 'test',
      data: { count: 1 },
    })
    expect(logRecordSchema.safeParse(sink.records[0]).success).toBe(true)
  })
})

describe('logger behavior', () => {
  it('gates levels before touching data and treats fatal as a log level', () => {
    const getter = vi.fn(() => 'synthetic')
    const data = Object.defineProperty({}, 'password', { get: getter, enumerable: true })
    const sink = createMemorySink()
    const log = createLogger({ ...options, level: 'warn', sinks: [sink] })
    log.debug('Hidden', data)
    log.info('Hidden', data)
    log.warn('Visible')
    log.error('Visible')
    log.fatal('Visible')
    expect(getter).not.toHaveBeenCalled()
    expect(sink.records.map((record) => record.level)).toEqual(['warn', 'error', 'fatal'])
    createLogger({ ...options, level: 'silent', sinks: [sink] }).fatal('Hidden')
    expect(sink.records).toHaveLength(3)
  })

  it('isolates bound contexts and snapshots fields before asynchronous sinks', () => {
    const sink = createMemorySink()
    const fields = { nested: { count: 1 } }
    const base = createLogger({ ...options, sinks: [sink] })
    const first = base.withContext({ requestId: 'first', data: fields }).child('cache')
    const second = base.withContext({ requestId: 'second' })
    fields.nested.count = 2
    first.info('Read')
    second.info('Read')
    base.info('Read')
    expect(sink.records.map((record) => record.requestId)).toEqual(['first', 'second', undefined])
    expect(sink.records[0]?.data).toEqual({ nested: { count: 1 } })
    expect(sink.records[0]?.scope).toBe('cache')
  })

  it('passes only immutable sanitized records to every sink and contains sink failures', () => {
    const sink = createMemorySink()
    const log = createLogger({
      ...options,
      sinks: [
        {
          write(record) {
            expect(record.data?.password).toBe('[REDACTED]')
            expect(Object.isFrozen(record.data)).toBe(true)
            throw new Error('Synthetic sink failure')
          },
        },
        sink,
      ],
    })
    expect(() =>
      log.info('Safe', { password: 'synthetic', value: privateValue('synthetic') }),
    ).not.toThrow()
    expect(sink.records[0]?.data).toEqual({ password: '[REDACTED]', value: '[REDACTED]' })
    expect(log.diagnostics.sinkFailures).toBe(1)
  })

  it('bounds hostile values and never calls getters or toJSON', () => {
    const getter = vi.fn(() => {
      throw new Error('must not run')
    })
    const input: Record<string, unknown> = { big: 999999999999999999n, toJSON: getter }
    input.self = input
    Object.defineProperty(input, 'getter', { get: getter, enumerable: true })
    const data = sanitizeFields(input)
    expect(getter).not.toHaveBeenCalled()
    expect(data.self).toBe('[Circular]')
    expect(data.big).toBe('999999999999999999')
    expect(data.getter).toBe('[Accessor]')
    expect(
      sanitizeFields(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('hostile')
            },
          },
        ),
      ),
    ).toBeDefined()
  })

  it('caps serialized records and keeps identity and error summaries', () => {
    const sink = createMemorySink()
    const log = createLogger({ ...options, sinks: [sink] })
    const data = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`key${i}`, '😀'.repeat(5000)]),
    )
    log.error('Bounded', { ...data, error: new Error('Synthetic') })
    const record = sink.records[0] as LogRecord
    expect(recordBytes(record)).toBeLessThanOrEqual(MAX_RECORD_BYTES)
    expect(record.service).toBe('fixture')
    expect(record.data).toEqual({ truncated: true })
    expect(logRecordSchema.safeParse(record).success).toBe(true)
  })

  it('normalizes error causes and honors stack configuration', () => {
    const error = new Error('Outer', { cause: new Error('Inner') })
    const sink = createMemorySink()
    createLogger({ ...options, sinks: [sink] }).error('Failed', { error })
    expect(sink.records[0]?.error).toEqual({
      name: 'Error',
      message: 'Outer',
      cause: { name: 'Error', message: 'Inner' },
    })
    expect(sanitizeErrorForLog(error, { includeStack: true }).stack).toContain('Outer')
    expect(sanitizeErrorForLog(null)).toEqual({ name: 'Error', message: 'Non-error thrown' })
    expect(sanitizeUrlForLog('https://[bad?token=synthetic')).toBe('[invalid URL]')
  })

  it('records an operation once and preserves its value or exact thrown object', async () => {
    const sink = createMemorySink()
    const log = createLogger({ ...options, sinks: [sink] })
    const result = { answer: 42 }
    expect(await log.operation('refresh', () => result)).toBe(result)
    const error = new Error('Synthetic operation failure')
    await expect(
      log.operation('refresh', () => {
        throw error
      }),
    ).rejects.toBe(error)
    expect(sink.records.map((record) => record.data?.outcome)).toEqual(['success', 'failure'])
    expect(sink.records[0]?.operationId).not.toBe(sink.records[1]?.operationId)
  })

  it('contains recursive sink logging and closes the shared sink once', async () => {
    const close = vi.fn(async () => {})
    const log = createLogger({
      ...options,
      sinks: [
        {
          write() {
            log.info('Recursion')
          },
          close,
        },
      ],
    })
    log.info('Outer')
    expect(log.diagnostics.dropped).toBe(1)
    await log.close()
    await log.child('closed').close()
    expect(close).toHaveBeenCalledOnce()
    log.error('After close')
    expect(log.diagnostics.dropped).toBe(2)
  })
})
