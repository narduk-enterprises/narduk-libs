/// <reference types="@cloudflare/workers-types" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteKVCache, withKVCache } from '../runtime/server/utils/kvCache'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({}),
}))

function createKV() {
  const values = new Map<string, string>()
  const puts: Array<{ key: string; options?: KVNamespacePutOptions; value: string }> = []

  return {
    kv: {
      async delete(key: string) {
        values.delete(key)
      },
      async get(key: string) {
        return values.get(key) ?? null
      },
      async put(key: string, value: string, options?: KVNamespacePutOptions) {
        puts.push({ key, options, value })
        values.set(key, value)
      },
    } as unknown as KVNamespace,
    puts,
    values,
  }
}

function createEvent(bindingName: string, kv: KVNamespace): H3Event {
  return {
    context: {
      cloudflare: {
        env: {
          [bindingName]: kv,
        },
      },
    },
    method: 'GET',
    path: '/test',
  } as unknown as H3Event
}

describe('KV cache helper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and returns cached data from a custom binding', async () => {
    const { kv, puts } = createKV()
    const event = createEvent('CONTROL_CACHE', kv)
    const producer = vi.fn(async () => ({ ok: true, value: 1 }))

    await expect(
      withKVCache(event, 'control:test', 60, producer, {
        bindingName: 'CONTROL_CACHE',
      }),
    ).resolves.toEqual({ ok: true, value: 1 })
    await expect(
      withKVCache(event, 'control:test', 60, producer, {
        bindingName: 'CONTROL_CACHE',
      }),
    ).resolves.toEqual({ ok: true, value: 1 })

    expect(producer).toHaveBeenCalledTimes(1)
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({
      key: 'control:test',
      options: { expirationTtl: 60 },
    })
  })

  it('uses Cloudflare KV minimum expiration TTL for shorter logical caches', async () => {
    const { kv, puts } = createKV()
    const event = createEvent('KV', kv)

    await withKVCache(event, 'short:test', 30, async () => 'fresh')

    expect(puts[0]?.options).toEqual({ expirationTtl: 60 })
  })

  it('can return cache metadata', async () => {
    const { kv } = createKV()
    const event = createEvent('KV', kv)

    const first = await withKVCache(event, 'meta:test', 30, async () => 'fresh', {
      returnMeta: true,
    })
    const second = await withKVCache(event, 'meta:test', 30, async () => 'unused', {
      returnMeta: true,
    })

    expect(first).toMatchObject({
      _meta: {
        hit: false,
        key: 'meta:test',
      },
      data: 'fresh',
    })
    expect(second).toMatchObject({
      _meta: {
        bindingName: 'KV',
        cachedAt: '2026-07-07T12:00:00.000Z',
        expiresAt: '2026-07-07T12:00:30.000Z',
        hit: true,
        key: 'meta:test',
      },
      data: 'fresh',
    })
  })

  it('refreshes when forced and deletes explicit keys', async () => {
    const { kv } = createKV()
    const event = createEvent('KV', kv)
    let counter = 0
    const producer = vi.fn(async () => {
      counter += 1
      return `value-${counter}`
    })

    await expect(withKVCache(event, 'force:test', 60, producer)).resolves.toBe('value-1')
    await expect(withKVCache(event, 'force:test', 60, producer, { force: true })).resolves.toBe(
      'value-2',
    )

    await deleteKVCache(event, 'force:test')
    await expect(withKVCache(event, 'force:test', 60, producer)).resolves.toBe('value-3')
  })

  it('falls back to the producer when the binding is unavailable', async () => {
    const event = {
      context: { cloudflare: { env: {} } },
      method: 'GET',
      path: '/test',
    } as unknown as H3Event

    await expect(withKVCache(event, 'missing:test', 60, async () => 'fresh')).resolves.toBe('fresh')
  })
})
