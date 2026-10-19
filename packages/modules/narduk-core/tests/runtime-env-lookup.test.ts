import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readRuntimeBoolean,
  readRuntimeEnvOverlay,
  readRuntimeString,
  readRuntimeStringFromKeys,
  readRuntimeStringList,
} from '../runtime/server/utils/runtime-env'
import { readWorkerRuntimeEnv, readWorkerRuntimeEnvValue } from '../runtime/server/utils/worker-env'

import type { H3Event } from 'h3'

function eventWithEnv(env: unknown): H3Event {
  return { context: { cloudflare: { env } } } as unknown as H3Event
}

function stubNodeEnv(env: Record<string, unknown>): void {
  vi.stubGlobal(
    'process',
    new Proxy(process, {
      get(target, key, receiver) {
        return key === 'env' ? env : Reflect.get(target, key, receiver)
      },
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('single-key Worker runtime overlay compatibility', () => {
  it('matches the full overlay for own, hidden, inherited and exceptional values', () => {
    const node = Object.create({ inherited: 'ignored-node' }) as Record<string, unknown>
    Object.assign(node, {
      nodeOnly: 'node',
      override: 'node',
      blank: 'node',
      undefined: 'node',
      null: 'node',
      throws: 'node',
    })
    Object.defineProperty(node, 'hiddenNode', { value: 'ignored-node' })
    Object.defineProperty(node, '__proto__', { value: 'node-proto', enumerable: true })
    const worker = Object.create({ inherited: 'ignored-worker' }) as Record<string, unknown>
    Object.assign(worker, {
      override: 'worker',
      blank: '',
      undefined: undefined,
      null: null,
      boolean: false,
      number: 0,
      bigint: 12n,
      object: {},
      array: [],
    })
    Object.defineProperty(worker, 'hiddenWorker', { value: 'worker' })
    Object.defineProperty(worker, '__proto__', { value: 'ignored-worker', enumerable: true })
    Object.defineProperty(worker, 'throws', {
      get() {
        throw new Error('unavailable binding')
      },
    })
    const event = eventWithEnv(worker)
    const overlay = readWorkerRuntimeEnv(event, node)
    for (const key of [
      'nodeOnly',
      'override',
      'blank',
      'undefined',
      'null',
      'throws',
      'boolean',
      'number',
      'bigint',
      'object',
      'array',
      'inherited',
      'hiddenNode',
      'hiddenWorker',
      '__proto__',
      'missing',
    ]) {
      const expected = Object.hasOwn(overlay, key) ? overlay[key] : undefined
      expect(readWorkerRuntimeEnvValue(event, key, node), key).toBe(expected)
    }
  })

  it('preserves direct, platform, isolate and Node source precedence', () => {
    vi.stubGlobal('__env__', { value: 'isolate' })
    const node = { value: 'node' }
    const platform = {
      context: { _platform: { cloudflare: { env: { value: 'platform' } } } },
    } as unknown as H3Event
    expect(readWorkerRuntimeEnvValue(eventWithEnv({ value: 'direct' }), 'value', node)).toBe(
      'direct',
    )
    expect(readWorkerRuntimeEnvValue(platform, 'value', node)).toBe('platform')
    expect(readWorkerRuntimeEnvValue(eventWithEnv(null), 'value', node)).toBe('isolate')
    expect(readWorkerRuntimeEnvValue(eventWithEnv({}), 'value', node)).toBe('node')
    expect(readWorkerRuntimeEnvValue(eventWithEnv('invalid'), 'value', node)).toBe('node')
    expect(readWorkerRuntimeEnvValue(undefined, 'value', node)).toBe('node')
    vi.stubGlobal('__env__', 'invalid')
    expect(readWorkerRuntimeEnvValue(eventWithEnv(null), 'value', node)).toBe('node')
  })

  it('does not cache either source and propagates a requested Node getter failure', () => {
    const env = { value: 'first' }
    const event = eventWithEnv(env)
    expect(readWorkerRuntimeEnvValue(event, 'value', {})).toBe('first')
    env.value = 'second'
    expect(readWorkerRuntimeEnvValue(event, 'value', {})).toBe('second')
    const node = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        throw new Error('Node value unavailable')
      },
    })
    expect(() => readWorkerRuntimeEnvValue(eventWithEnv({}), 'value', node)).toThrow(
      'Node value unavailable',
    )
    expect(() => readWorkerRuntimeEnvValue(event, 'value', node)).toThrow('Node value unavailable')
  })
})

describe('runtime readers without full environment copies', () => {
  it('reads only requested bindings, independently of unrelated environment size', () => {
    let unrelatedReads = 0
    let enumerations = 0
    const source: Record<string, unknown> = { value: ' true, true, false ' }
    for (let i = 0; i < 128; i++) {
      Object.defineProperty(source, `unrelated_${i}`, {
        enumerable: true,
        get() {
          unrelatedReads++
          return 'unused'
        },
      })
    }
    const env = new Proxy(source, {
      ownKeys(target) {
        enumerations++
        return Reflect.ownKeys(target)
      },
    })
    stubNodeEnv(env)
    const event = eventWithEnv(env)
    expect(readRuntimeString(event, 'value')).toBe('true, true, false')
    expect(readRuntimeStringFromKeys(event, ['missing', 'value'])).toBe('true, true, false')
    expect(readRuntimeBoolean(event, 'value', { fallback: true })).toBe(true)
    expect(readRuntimeStringList(event, 'value')).toEqual(['true', 'false'])
    expect(readRuntimeString(eventWithEnv({}), 'value')).toBe('true, true, false')
    expect(unrelatedReads).toBe(0)
    expect(enumerations).toBe(0)
    // The full-overlay API still enumerates and copies the complete sources.
    expect(readRuntimeEnvOverlay(event, env).unrelated_127).toBe('unused')
    expect(unrelatedReads).toBe(256)
    expect(enumerations).toBe(2)
  })

  it('keeps explicit undefined/blank authoritative and preserves scalar fallbacks', () => {
    stubNodeEnv({ value: 'node' })
    const empty = eventWithEnv({ value: '' })
    const missing = eventWithEnv({ value: undefined })
    expect(readRuntimeString(empty, 'value', { fallback: 'fallback' })).toBe('')
    expect(readRuntimeStringList(empty, 'value', { fallbackList: ['fallback'] })).toEqual([])
    expect(readRuntimeString(missing, 'value', { fallback: 'fallback' })).toBe('fallback')
    expect(readRuntimeBoolean(missing, 'value', { fallback: true })).toBe(true)
    expect(readRuntimeStringList(missing, 'value', { fallbackList: ['a', ' a ', 'b'] })).toEqual([
      'a',
      'b',
    ])
    expect(readRuntimeString(eventWithEnv({ value: 12n }), 'value')).toBe('12')
    expect(readRuntimeStringFromKeys(empty, ['value'], { fallbacks: ['fallback'] })).toBe('')
    expect(readRuntimeStringFromKeys(missing, ['value'], { fallbacks: ['first'] })).toBe('first')
    expect(readRuntimeStringFromKeys(eventWithEnv({}), [], { fallback: 'last' })).toBe('last')
  })
})
