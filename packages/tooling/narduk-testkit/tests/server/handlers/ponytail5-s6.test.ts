import { describe, expect, it } from 'vitest'

import { createFakeKVNamespace } from '../../../src/server/handlers/fake-kv'
import { createFakeR2Bucket } from '../../../src/server/handlers/fake-r2'

describe('ponytail-5 s6 testkit fakes (#19)', () => {
  it('R2 keeps its own copy of a Buffer the caller refills', async () => {
    const bucket = createFakeR2Bucket()
    const pooled = Buffer.from('aaaa')
    await bucket.put('a', pooled)
    pooled.fill('b')
    await bucket.put('b', pooled)
    const a = await bucket.get('a')
    expect(await a?.text()).toBe('aaaa')
  })

  it('R2 keeps its own copy of a typed-array view', async () => {
    const bucket = createFakeR2Bucket()
    const bytes = new Uint8Array([1, 2, 3])
    await bucket.put('v', bytes)
    bytes.fill(0)
    const object = await bucket.get('v')
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('KV does not share the caller metadata object', async () => {
    const kv = createFakeKVNamespace()
    const metadata = { role: 'user' }
    await kv.put('session', 'token', { metadata })
    metadata.role = 'admin'
    const stored = await kv.getWithMetadata('session')
    expect(stored.metadata).toEqual({ role: 'user' })
  })

  it('KV rejects metadata that is not JSON and a list limit of 0', async () => {
    const kv = createFakeKVNamespace()
    await expect(kv.put('k', 'v', { metadata: () => 1 as never })).rejects.toThrow(/JSON/)
    await kv.put('k', 'v')
    await expect(kv.list({ limit: 0 })).rejects.toThrow(/key_count_limit/)
    await expect(kv.list({ limit: 1.5 })).rejects.toThrow(/key_count_limit/)
  })
})
