import { describe, expect, it } from 'vitest'

import { createFakeR2Bucket } from '../../../src/server/handlers/fake-r2'

describe('createFakeR2Bucket', () => {
  it('returns null from get/head for a missing key', async () => {
    const bucket = createFakeR2Bucket()
    await expect(bucket.get('missing')).resolves.toBeNull()
    await expect(bucket.head('missing')).resolves.toBeNull()
  })

  it('stores and retrieves an object body as text', async () => {
    const bucket = createFakeR2Bucket()
    await bucket.put('greeting.txt', 'hello world')

    const object = await bucket.get('greeting.txt')
    expect(object).not.toBeNull()
    await expect(object?.text()).resolves.toBe('hello world')
  })

  it('round-trips a JSON body', async () => {
    const bucket = createFakeR2Bucket()
    await bucket.put('data.json', JSON.stringify({ ok: true }))

    const object = await bucket.get('data.json')
    await expect(object?.json()).resolves.toEqual({ ok: true })
  })

  it('computes a stable etag for identical bodies', async () => {
    const bucket = createFakeR2Bucket()
    // `put()`'s first overload (matched here because its `options` param is
    // also optional) types its return as `R2Object | null`, even though this
    // fake -- like real R2 without an `onlyIf` condition -- never resolves
    // null; the `!` reflects that guarantee rather than papering over one.
    const first = (await bucket.put('a', 'same body'))!
    const second = (await bucket.put('b', 'same body'))!
    expect(first.etag).toBe(second.etag)
    expect(first.httpEtag).toBe(`"${first.etag}"`)
  })

  it('head omits the body but reports size and metadata', async () => {
    const bucket = createFakeR2Bucket()
    await bucket.put('image.png', Buffer.from([1, 2, 3, 4]), {
      httpMetadata: { contentType: 'image/png' },
    })

    const head = await bucket.head('image.png')
    expect(head?.size).toBe(4)
    expect(head?.httpMetadata?.contentType).toBe('image/png')
    expect('body' in (head ?? {})).toBe(false)
  })

  it('deletes one or many keys', async () => {
    const bucket = createFakeR2Bucket()
    await bucket.put('a', '1')
    await bucket.put('b', '2')

    await bucket.delete(['a', 'b'])

    await expect(bucket.get('a')).resolves.toBeNull()
    await expect(bucket.get('b')).resolves.toBeNull()
  })

  it('lists objects by prefix in lexicographic order', async () => {
    const bucket = createFakeR2Bucket()
    await bucket.put('uploads/b.png', '2')
    await bucket.put('uploads/a.png', '1')
    await bucket.put('other/c.png', '3')

    const result = await bucket.list({ prefix: 'uploads/' })
    expect(result.objects.map((object) => object.key)).toEqual(['uploads/a.png', 'uploads/b.png'])
    expect(result.truncated).toBe(false)
  })

  it('paginates a list with limit and cursor', async () => {
    const bucket = createFakeR2Bucket()
    await bucket.put('a', '1')
    await bucket.put('b', '2')
    await bucket.put('c', '3')

    const first = await bucket.list({ limit: 2 })
    expect(first.truncated).toBe(true)
    expect(first.objects.map((object) => object.key)).toEqual(['a', 'b'])
    if (!first.truncated) throw new Error('expected the first page to be truncated')

    const second = await bucket.list({ cursor: first.cursor, limit: 2 })
    expect(second.truncated).toBe(false)
    expect(second.objects.map((object) => object.key)).toEqual(['c'])
  })

  it('stamps uploaded from an injected clock', async () => {
    const fixed = new Date('2026-09-17T00:00:00.000Z')
    const bucket = createFakeR2Bucket({ now: () => fixed })
    const object = (await bucket.put('key', 'value'))!
    expect(object.uploaded).toEqual(fixed)
  })

  describe('put() body normalization', () => {
    it('accepts an ArrayBufferView (typed array) body', async () => {
      const bucket = createFakeR2Bucket()
      const view = new Uint8Array([104, 105]) // "hi"
      await bucket.put('view', view)

      const object = await bucket.get('view')
      await expect(object?.text()).resolves.toBe('hi')
    })

    it('accepts a typed-array view over a larger, offset ArrayBuffer', async () => {
      const bucket = createFakeR2Bucket()
      const backing = new Uint8Array([0, 0, 104, 105, 0]).buffer
      const view = new Uint8Array(backing, 2, 2) // "hi", offset into a shared buffer
      await bucket.put('offset-view', view)

      const object = await bucket.get('offset-view')
      await expect(object?.text()).resolves.toBe('hi')
    })

    it('accepts a raw ArrayBuffer body', async () => {
      const bucket = createFakeR2Bucket()
      // `.buffer` types as `ArrayBufferLike` (it could be a `SharedArrayBuffer`);
      // it never is one here, so this asserts the narrower type `put()` declares.
      const buffer = new TextEncoder().encode('raw buffer').buffer as ArrayBuffer
      await bucket.put('buf', buffer)

      const object = await bucket.get('buf')
      await expect(object?.text()).resolves.toBe('raw buffer')
    })

    it('accepts a Blob body', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('blob-key', new Blob(['blob body']))

      const object = await bucket.get('blob-key')
      await expect(object?.text()).resolves.toBe('blob body')
    })

    it('accepts a ReadableStream body', async () => {
      const bucket = createFakeR2Bucket()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('stream '))
          controller.enqueue(new TextEncoder().encode('body'))
          controller.close()
        },
      })
      await bucket.put('stream-key', stream)

      const object = await bucket.get('stream-key')
      await expect(object?.text()).resolves.toBe('stream body')
    })

    it('stores an empty body for null', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('empty', null)

      const object = await bucket.get('empty')
      await expect(object?.text()).resolves.toBe('')
    })
  })

  describe('R2ObjectBody read methods', () => {
    it('reads the body as arrayBuffer()', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'array buffer body')

      const object = await bucket.get('key')
      const buffer = await object?.arrayBuffer()
      expect(Buffer.from(buffer as ArrayBuffer).toString('utf8')).toBe('array buffer body')
    })

    it('reads the body as blob()', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'blob body')

      const object = await bucket.get('key')
      const blob = await object?.blob()
      expect(blob).toBeInstanceOf(Blob)
      await expect(blob?.text()).resolves.toBe('blob body')
    })

    it('reads the body as bytes()', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'bytes body')

      const object = await bucket.get('key')
      const bytes = await object?.bytes()
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(Buffer.from(bytes as Uint8Array).toString('utf8')).toBe('bytes body')
    })

    it('exposes the body as a ReadableStream via the body getter', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'stream getter body')

      const object = await bucket.get('key')
      const reader = (object?.body as unknown as ReadableStream<Uint8Array>).getReader()
      const chunks: Uint8Array[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      expect(Buffer.concat(chunks).toString('utf8')).toBe('stream getter body')
    })

    it('tracks bodyUsed across the read methods', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'value')

      const object = await bucket.get('key')
      expect(object?.bodyUsed).toBe(false)
      await object?.text()
      expect(object?.bodyUsed).toBe(true)
    })
  })

  describe('writeHttpMetadata()', () => {
    it('writes content-type and cache-control from stored httpMetadata', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'value', {
        httpMetadata: { cacheControl: 'max-age=60', contentType: 'text/plain' },
      })

      const object = await bucket.head('key')
      const headers = new Headers()
      object?.writeHttpMetadata(headers)
      expect(headers.get('content-type')).toBe('text/plain')
      expect(headers.get('cache-control')).toBe('max-age=60')
    })

    it('writes nothing when no httpMetadata was stored', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'value')

      const object = await bucket.head('key')
      const headers = new Headers()
      object?.writeHttpMetadata(headers)
      expect(headers.get('content-type')).toBeNull()
      expect(headers.get('cache-control')).toBeNull()
    })
  })
})
