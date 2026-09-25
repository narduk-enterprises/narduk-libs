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

    // A real R2 body is single-use and throws on a second read. A fake that
    // replays the bytes hides a double-read bug until production.
    it('refuses a second read of the same body', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'value')

      const object = await bucket.get('key')
      await expect(object?.text()).resolves.toBe('value')
      await expect(object?.text()).rejects.toThrow(/already been used/)
    })

    it('refuses a text() read after the body stream was taken', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'value')

      const object = await bucket.get('key')
      expect(object).not.toBeNull()
      void object?.body
      await expect(object?.text()).rejects.toThrow(/already been used/)
    })
  })

  // Each case below was verified against a real binding via miniflare.
  describe('ranged reads', () => {
    it('returns only the requested window and reports it', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'hello world')

      const object = await bucket.get('key', { range: { length: 5, offset: 0 } })
      await expect(object?.text()).resolves.toBe('hello')
      expect(object?.range).toEqual({ length: 5, offset: 0 })
      // `size` stays the whole object's size, even for a ranged read.
      expect(object?.size).toBe(11)
    })

    it('resolves a suffix range from the end', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'hello world')

      const object = await bucket.get('key', { range: { suffix: 5 } })
      await expect(object?.text()).resolves.toBe('world')
      expect(object?.range).toEqual({ length: 5, offset: 6 })
    })

    it('runs a bare offset to the end of the object', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'hello world')

      const object = await bucket.get('key', { range: { offset: 6 } })
      await expect(object?.text()).resolves.toBe('world')
      expect(object?.range).toEqual({ length: 5, offset: 6 })
    })

    it('rejects a range starting past the end of the object', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'hello world')

      await expect(bucket.get('key', { range: { length: 5, offset: 100 } })).rejects.toThrow(
        /not satisfiable/,
      )
    })

    it('reports a full-object range on an unranged get and on head', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'hello world')

      expect((await bucket.get('key'))?.range).toEqual({ length: 11, offset: 0 })
      expect((await bucket.head('key'))?.range).toEqual({ length: 11, offset: 0 })
    })
  })

  describe('metadata fidelity', () => {
    it('omits both metadata maps from list() unless include asks for them', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('report.pdf', 'body', {
        customMetadata: { owner: 'logan' },
        httpMetadata: { contentType: 'application/pdf' },
      })

      const bare = await bucket.list({ prefix: 'report' })
      expect(bare.objects[0]?.httpMetadata).toEqual({})
      expect(bare.objects[0]?.customMetadata).toEqual({})

      // `include` is cast because @cloudflare/workers-types@4.20260511.1 omits
      // it from `R2ListOptions`, though a real bucket honours it.
      const included = await bucket.list({
        include: ['customMetadata', 'httpMetadata'],
        prefix: 'report',
      } as R2ListOptions)
      expect(included.objects[0]?.httpMetadata).toEqual({ contentType: 'application/pdf' })
      expect(included.objects[0]?.customMetadata).toEqual({ owner: 'logan' })
    })

    it('reports empty metadata maps, not undefined, for an object with none', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('plain', 'body')

      const object = await bucket.head('plain')
      expect(object?.httpMetadata).toEqual({})
      expect(object?.customMetadata).toEqual({})
    })

    it('exposes the md5 checksum the etag is computed from', async () => {
      const bucket = createFakeR2Bucket()
      // `put` resolves to workers-types' nullable `onlyIf` overload (its
      // `options` parameter is optional), so narrow before asserting.
      const object = await bucket.put('key', 'hello world')
      expect(object).not.toBeNull()
      expect(object?.checksums.toJSON()).toEqual({ md5: object?.etag })
    })
  })

  it('refuses a conditional get rather than silently ignoring onlyIf', async () => {
    const bucket = createFakeR2Bucket()
    await bucket.put('key', 'value')

    // A real bucket answers a failed precondition with a body-less R2Object.
    // Quietly returning the full body here would make a broken handler green.
    await expect(bucket.get('key', { onlyIf: { etagMatches: 'bogus' } })).rejects.toThrow(/onlyIf/)
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

  // narduk-libs#916. Every expectation below was first observed on a real
  // binding: miniflare 4.20260701.0's R2 (workerd), driven from inside a
  // Worker for the Headers cases.
  describe('put() conditions, checksums and Headers metadata', () => {
    const MD5_OF_BODY = '841a2d689ad86bd1611447453c22c6fc' // md5('body')

    it('treats etagDoesNotMatch "*" as create-if-absent: null, and no write, once the key exists', async () => {
      const bucket = createFakeR2Bucket()
      const created = await bucket.put('key', 'one', { onlyIf: { etagDoesNotMatch: '*' } })
      expect(created?.size).toBe(3)

      await expect(
        bucket.put('key', 'two', { onlyIf: { etagDoesNotMatch: '*' } }),
      ).resolves.toBeNull()
      await expect((await bucket.get('key'))?.text()).resolves.toBe('one')
    })

    it('writes on a matching etag and resolves null on a stale one', async () => {
      const bucket = createFakeR2Bucket()
      const first = (await bucket.put('key', 'one'))!

      await expect(bucket.put('key', 'x', { onlyIf: { etagMatches: 'stale' } })).resolves.toBeNull()
      const second = await bucket.put('key', 'two', { onlyIf: { etagMatches: first.etag } })
      expect(second?.etag).not.toBe(first.etag)
      await expect(
        bucket.put('key', 'x', { onlyIf: { etagDoesNotMatch: second!.etag } }),
      ).resolves.toBeNull()
      await expect((await bucket.get('key'))?.text()).resolves.toBe('two')
    })

    it.each([
      ['etagMatches "abc"', { etagMatches: 'abc' }, false],
      ['etagMatches "*"', { etagMatches: '*' }, false],
      ['etagDoesNotMatch "abc"', { etagDoesNotMatch: 'abc' }, true],
      ['uploadedBefore the epoch', { uploadedBefore: new Date(0) }, true],
      ['uploadedAfter the future', { uploadedAfter: new Date(Date.now() + 1e9) }, false],
    ] as const)(
      'decides %s against a missing key as the runtime does',
      async (_label, onlyIf, writes) => {
        const bucket = createFakeR2Bucket()
        const result = await bucket.put('missing', 'x', { onlyIf })
        expect(result !== null).toBe(writes)
        expect((await bucket.head('missing')) !== null).toBe(writes)
      },
    )

    it('decides uploadedBefore/uploadedAfter against the stored upload time', async () => {
      const bucket = createFakeR2Bucket({ now: () => new Date('2026-09-25T12:00:00.000Z') })
      await bucket.put('key', 'one')

      await expect(
        bucket.put('key', 'x', { onlyIf: { uploadedBefore: new Date(0) } }),
      ).resolves.toBeNull()
      await expect(
        bucket.put('key', 'x', { onlyIf: { uploadedAfter: new Date('2026-09-25T13:00:00.000Z') } }),
      ).resolves.toBeNull()
      await expect(
        bucket.put('key', 'two', { onlyIf: { uploadedAfter: new Date(0) } }),
      ).resolves.not.toBeNull()
    })

    it('refuses a quoted etag with the runtime message, and the forms it does not emulate', async () => {
      const bucket = createFakeR2Bucket()
      await expect(bucket.put('key', 'x', { onlyIf: { etagMatches: '"abc"' } })).rejects.toThrow(
        'Conditional ETag should not be wrapped in quotes ("abc").',
      )
      await expect(bucket.put('key', 'x', { onlyIf: { etagMatches: 'W/"abc"' } })).rejects.toThrow(
        /weak conditional etags/,
      )
      await expect(
        bucket.put('key', 'x', { onlyIf: new Headers({ 'if-none-match': '*' }) }),
      ).rejects.toThrow(/Headers object/)
      expect(await bucket.head('key')).toBeNull()
    })

    it('rejects a checksum that does not match the body, with the runtime message and code', async () => {
      const bucket = createFakeR2Bucket()
      await expect(bucket.put('key', 'body', { md5: '0'.repeat(32) })).rejects.toThrow(
        `put: The MD5 checksum you specified did not match what we received.\nYou provided a MD5 checksum with value: ${'0'.repeat(32)}\nActual MD5 was: ${MD5_OF_BODY} (10037)`,
      )
      await expect(bucket.put('key', 'body', { sha256: '0'.repeat(64) })).rejects.toThrow(
        /The SHA-256 checksum you specified did not match[\s\S]*\(10037\)$/u,
      )
      await expect(bucket.put('key', 'body', { md5: new Uint8Array(16).buffer })).rejects.toThrow(
        /MD5 checksum you specified did not match/,
      )
      expect(await bucket.head('key')).toBeNull()
    })

    it('stores the body when the checksum matches, as hex or as bytes', async () => {
      const bucket = createFakeR2Bucket()
      await expect(bucket.put('hex', 'body', { md5: MD5_OF_BODY })).resolves.not.toBeNull()
      await expect(
        bucket.put('bytes', 'body', { md5: Buffer.from(MD5_OF_BODY, 'hex') }),
      ).resolves.not.toBeNull()
      await expect(
        bucket.put('upper', 'body', { md5: MD5_OF_BODY.toUpperCase() }),
      ).resolves.not.toBeNull()
    })

    it('refuses more than one checksum algorithm', async () => {
      const bucket = createFakeR2Bucket()
      await expect(bucket.put('key', 'body', { md5: MD5_OF_BODY, sha1: 'x' })).rejects.toThrow(
        'You cannot specify multiple hashing algorithms.',
      )
    })

    it('checks the precondition before the checksum', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'one')
      await expect(
        bucket.put('key', 'body', { md5: '0'.repeat(32), onlyIf: { etagDoesNotMatch: '*' } }),
      ).resolves.toBeNull()
    })

    it('parses a Headers httpMetadata into R2HTTPMetadata and writes it back', async () => {
      const bucket = createFakeR2Bucket()
      await bucket.put('key', 'x', {
        httpMetadata: new Headers({
          'cache-control': 'no-store',
          'content-disposition': 'inline',
          'content-encoding': 'identity',
          'content-language': 'en',
          'content-type': 'text/plain',
          expires: 'Wed, 21 Oct 2015 07:28:00 GMT',
          'x-other': 'y',
        }),
      })

      const object = await bucket.head('key')
      expect(object?.httpMetadata).toEqual({
        cacheControl: 'no-store',
        cacheExpiry: new Date('2015-10-21T07:28:00.000Z'),
        contentDisposition: 'inline',
        contentEncoding: 'identity',
        contentLanguage: 'en',
        contentType: 'text/plain',
      })
      const headers = new Headers()
      object?.writeHttpMetadata(headers)
      expect([...headers]).toEqual([
        ['cache-control', 'no-store'],
        ['content-disposition', 'inline'],
        ['content-encoding', 'identity'],
        ['content-language', 'en'],
        ['content-type', 'text/plain'],
        ['expires', 'Wed, 21 Oct 2015 07:28:00 GMT'],
      ])
    })
  })
})
