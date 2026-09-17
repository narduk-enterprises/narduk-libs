import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeKVNamespace } from '../../../src/server/handlers/fake-kv'

describe('createFakeKVNamespace', () => {
  it('returns null for a missing key', async () => {
    const kv = createFakeKVNamespace()
    await expect(kv.get('missing')).resolves.toBeNull()
  })

  it('stores and returns a string value', async () => {
    const kv = createFakeKVNamespace()
    await kv.put('greeting', 'hello')
    await expect(kv.get('greeting')).resolves.toBe('hello')
  })

  it('decodes a JSON get', async () => {
    const kv = createFakeKVNamespace()
    await kv.put('user', JSON.stringify({ id: 1 }))
    await expect(kv.get('user', 'json')).resolves.toEqual({ id: 1 })
  })

  it('deletes a key', async () => {
    const kv = createFakeKVNamespace()
    await kv.put('temp', 'x')
    await kv.delete('temp')
    await expect(kv.get('temp')).resolves.toBeNull()
  })

  it('stores and returns metadata alongside a value', async () => {
    const kv = createFakeKVNamespace()
    await kv.put('with-meta', 'value', { metadata: { version: 2 } })
    await expect(kv.getWithMetadata('with-meta')).resolves.toEqual({
      cacheStatus: null,
      metadata: { version: 2 },
      value: 'value',
    })
  })

  it('lists keys by prefix, in lexicographic order', async () => {
    const kv = createFakeKVNamespace()
    await kv.put('cache:b', '2')
    await kv.put('cache:a', '1')
    await kv.put('other:z', '9')

    const result = await kv.list({ prefix: 'cache:' })
    expect(result.list_complete).toBe(true)
    expect(result.keys.map((key) => key.name)).toEqual(['cache:a', 'cache:b'])
  })

  it('pages a list with limit and cursor', async () => {
    const kv = createFakeKVNamespace()
    await kv.put('a', '1')
    await kv.put('b', '2')
    await kv.put('c', '3')

    const first = await kv.list({ limit: 2 })
    expect(first.list_complete).toBe(false)
    expect(first.keys.map((key) => key.name)).toEqual(['a', 'b'])
    expect('cursor' in first).toBe(true)

    const second = await kv.list({ cursor: (first as { cursor: string }).cursor, limit: 2 })
    expect(second.list_complete).toBe(true)
    expect(second.keys.map((key) => key.name)).toEqual(['c'])
  })

  describe('expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('expires a key after expirationTtl seconds', async () => {
      const kv = createFakeKVNamespace()
      await kv.put('short-lived', 'value', { expirationTtl: 60 })

      await expect(kv.get('short-lived')).resolves.toBe('value')

      vi.setSystemTime(new Date('2026-09-17T12:00:59.000Z'))
      await expect(kv.get('short-lived')).resolves.toBe('value')

      vi.setSystemTime(new Date('2026-09-17T12:01:00.000Z'))
      await expect(kv.get('short-lived')).resolves.toBeNull()
    })

    it('expires a key at an absolute expiration timestamp', async () => {
      const kv = createFakeKVNamespace()
      const expiresAtSeconds = Math.floor(new Date('2026-09-17T12:05:00.000Z').getTime() / 1000)
      await kv.put('absolute', 'value', { expiration: expiresAtSeconds })

      vi.setSystemTime(new Date('2026-09-17T12:04:59.000Z'))
      await expect(kv.get('absolute')).resolves.toBe('value')

      vi.setSystemTime(new Date('2026-09-17T12:05:00.000Z'))
      await expect(kv.get('absolute')).resolves.toBeNull()
    })

    it('omits an expired key from list()', async () => {
      const kv = createFakeKVNamespace()
      await kv.put('expiring', 'value', { expirationTtl: 30 })
      await kv.put('permanent', 'value')

      vi.setSystemTime(new Date('2026-09-17T12:00:31.000Z'))
      const result = await kv.list({})
      expect(result.keys.map((key) => key.name)).toEqual(['permanent'])
    })

    it('accepts an injected clock instead of the system clock', async () => {
      let currentMs = 0
      const kv = createFakeKVNamespace({ now: () => currentMs })
      await kv.put('key', 'value', { expirationTtl: 10 })

      currentMs = 9_999
      await expect(kv.get('key')).resolves.toBe('value')

      currentMs = 10_000
      await expect(kv.get('key')).resolves.toBeNull()
    })
  })
})
