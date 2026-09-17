import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  ALLOWED_TYPES,
  capIncomingMessageBytes,
  CRITICAL_RASTER_WARNING_SIZE,
  enforceUploadBodyByteCap,
  getUploadPerformanceWarnings,
  isAllowedUploadContentType,
  MAX_FILE_SIZE,
  MAX_UPLOAD_REQUEST_SIZE,
  normalizeExtension,
  normalizeUploadContentType,
  PUBLIC_RASTER_WARNING_SIZE,
  validateUploadFiles,
} from '../../runtime/server/utils/upload'

const defineUserMutation = vi.hoisted(() => vi.fn((options: unknown) => ({ options })))
const getHeader = vi.hoisted(() => vi.fn())
const readMultipartFormData = vi.hoisted(() => vi.fn())

vi.mock('h3', () => ({
  createError: (opts: { message: string; statusCode: number }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  },
  getHeader,
  readMultipartFormData,
}))

vi.mock('#layer/server/utils/mutation', () => ({
  defineUserMutation,
}))

vi.mock('#layer/server/utils/rateLimit', () => ({
  RATE_LIMIT_POLICIES: {
    upload: { limit: 60, windowMs: 60_000 },
  },
}))

vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => ({
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}))

vi.mock('@narduk-enterprises/narduk-uploads/runtime/server/utils/r2', () => ({
  uploadToR2: vi.fn(),
}))

function makeFile(type: string, sizeBytes = 1024): { data: Uint8Array; type: string } {
  return { data: new Uint8Array(sizeBytes), type }
}

describe('upload endpoint request sizing', () => {
  it('rejects oversized requests before multipart buffering', async () => {
    vi.resetModules()
    readMultipartFormData.mockResolvedValue([{ data: new Uint8Array(1), filename: 'a.png' }])
    getHeader.mockReturnValue(String(MAX_UPLOAD_REQUEST_SIZE + 1))

    const route = await import('../../runtime/server/api/upload.post')
    const handler = route.default as {
      options: { parseBody: (event: unknown) => Promise<unknown> }
    }

    await expect(handler.options.parseBody({})).rejects.toMatchObject({
      message: `Upload request exceeds ${MAX_UPLOAD_REQUEST_SIZE / 1024 / 1024}MB limit`,
      statusCode: 413,
    })
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })

  it('continues parsing multipart requests above the per-file size limit', async () => {
    vi.resetModules()
    readMultipartFormData.mockResolvedValue([{ data: new Uint8Array(1), filename: 'a.png' }])
    getHeader.mockReturnValue(String(MAX_FILE_SIZE + 1024))

    const route = await import('../../runtime/server/api/upload.post')
    const handler = route.default as {
      options: { parseBody: (event: unknown) => Promise<unknown> }
    }

    await expect(handler.options.parseBody({})).resolves.toEqual([
      { data: expect.any(Uint8Array), filename: 'a.png' },
    ])
    expect(readMultipartFormData).toHaveBeenCalledTimes(1)
  })

  it('rejects requests with no Content-Length before buffering', async () => {
    vi.resetModules()
    readMultipartFormData.mockReset()
    getHeader.mockReturnValue(undefined)

    const route = await import('../../runtime/server/api/upload.post')
    const handler = route.default as {
      options: { parseBody: (event: unknown) => Promise<unknown> }
    }

    await expect(handler.options.parseBody({})).rejects.toMatchObject({
      message: 'Content-Length is required',
      statusCode: 411,
    })
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })

  it('rejects requests with a non-finite Content-Length before buffering', async () => {
    vi.resetModules()
    readMultipartFormData.mockReset()
    getHeader.mockReturnValue('not-a-length')

    const route = await import('../../runtime/server/api/upload.post')
    const handler = route.default as {
      options: { parseBody: (event: unknown) => Promise<unknown> }
    }

    await expect(handler.options.parseBody({})).rejects.toMatchObject({
      message: 'Content-Length is required',
      statusCode: 411,
    })
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })
})

describe('capIncomingMessageBytes', () => {
  it('destroys the request once the byte cap is exceeded', () => {
    const req = new EventEmitter()
    req.destroy = vi.fn()
    capIncomingMessageBytes(req, 8)
    req.emit('data', new Uint8Array(5))
    expect(req.destroy).not.toHaveBeenCalled()
    req.emit('data', new Uint8Array(4))
    expect(req.destroy).toHaveBeenCalledTimes(1)
    expect(req.destroy.mock.calls[0]?.[0]).toMatchObject({ statusCode: 413 })
  })
})

describe('upload content-type allow-list', () => {
  it('normalizes parameters and case to the shared ALLOWED_TYPES keys', () => {
    expect(normalizeUploadContentType('image/PNG; charset=x')).toBe('image/png')
    expect(normalizeUploadContentType('IMAGE/JPEG')).toBe('image/jpeg')
    expect(normalizeUploadContentType(undefined)).toBe('')
    expect(normalizeUploadContentType('')).toBe('')
  })

  it('accepts allow-listed types and rejects HTML, JS, SVG, and missing types', () => {
    for (const type of ALLOWED_TYPES) {
      expect(isAllowedUploadContentType(type)).toBe(true)
    }
    expect(isAllowedUploadContentType('image/PNG; charset=x')).toBe(true)
    expect(isAllowedUploadContentType('text/html')).toBe(false)
    expect(isAllowedUploadContentType('application/javascript')).toBe(false)
    expect(isAllowedUploadContentType('image/svg+xml')).toBe(false)
    expect(isAllowedUploadContentType(undefined)).toBe(false)
  })
})

describe('validateUploadFiles', () => {
  it('accepts valid image types', () => {
    for (const type of ALLOWED_TYPES) {
      expect(() => validateUploadFiles([makeFile(type)])).not.toThrow()
    }
  })

  it('rejects unsupported MIME types', () => {
    expect(() => validateUploadFiles([makeFile('application/pdf')])).toThrow(
      'Unsupported file type: application/pdf',
    )
  })

  it('rejects SVG uploads so scripts cannot be served from the first-party origin', () => {
    expect(() => validateUploadFiles([makeFile('image/svg+xml')])).toThrow(
      'Unsupported file type: image/svg+xml',
    )
  })

  it('rejects files with missing type', () => {
    const file = { data: new Uint8Array(100), type: undefined }
    expect(() => validateUploadFiles([file])).toThrow('Unsupported file type: unknown')
  })

  it('rejects files exceeding the size limit', () => {
    const oversized = makeFile('image/png', MAX_FILE_SIZE + 1)
    expect(() => validateUploadFiles([oversized])).toThrow('File exceeds 10MB limit')
  })

  it('accepts files at exactly the size limit', () => {
    const atLimit = makeFile('image/png', MAX_FILE_SIZE)
    expect(() => validateUploadFiles([atLimit])).not.toThrow()
  })

  it('validates each file independently in multi-file uploads', () => {
    const good = makeFile('image/png')
    const bad = makeFile('application/zip')
    expect(() => validateUploadFiles([good, bad])).toThrow('Unsupported file type')
  })

  it('passes when all files in a multi-file upload are valid', () => {
    const files = [makeFile('image/jpeg'), makeFile('image/webp'), makeFile('image/gif')]
    expect(() => validateUploadFiles(files)).not.toThrow()
  })
})

describe('getUploadPerformanceWarnings', () => {
  it('warns on large public raster uploads', () => {
    const warnings = getUploadPerformanceWarnings(
      makeFile('image/png', PUBLIC_RASTER_WARNING_SIZE + 1),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'large-public-raster',
        thresholdBytes: PUBLIC_RASTER_WARNING_SIZE,
      }),
    ])
  })

  it('uses a stricter threshold for likely critical images', () => {
    const warnings = getUploadPerformanceWarnings({
      ...makeFile('image/jpeg', CRITICAL_RASTER_WARNING_SIZE + 1),
      filename: 'home-hero.jpg',
    })

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'large-critical-raster',
        thresholdBytes: CRITICAL_RASTER_WARNING_SIZE,
      }),
    ])
  })

  it('does not warn for small raster uploads', () => {
    expect(getUploadPerformanceWarnings(makeFile('image/webp', 64 * 1024))).toHaveLength(0)
  })
})

describe('normalizeExtension', () => {
  it('normalises image/jpeg to jpg', () => {
    expect(normalizeExtension('image/jpeg')).toBe('jpg')
  })

  it('passes through simple subtypes', () => {
    expect(normalizeExtension('image/png')).toBe('png')
    expect(normalizeExtension('image/webp')).toBe('webp')
    expect(normalizeExtension('image/gif')).toBe('gif')
    expect(normalizeExtension('image/avif')).toBe('avif')
  })

  it('falls back to bin for unknown types', () => {
    expect(normalizeExtension('application')).toBe('bin')
  })
})

interface CapEvent {
  _requestBody?: unknown
  node?: { req?: unknown }
  web?: { request?: { body?: unknown } }
}

interface StreamProbe {
  cancelled: unknown
  /** Bytes the source actually handed out — what the Worker read off the wire. */
  produced: number
  pulls: number
}

/**
 * A web `ReadableStream` with `highWaterMark: 0`, so the source is pulled only
 * when the reader asks for the next chunk. `produced` is then exactly the byte
 * count the runtime read, which is the number the cap has to bound. The same
 * chunk instance is re-enqueued so a 100MB-cap test costs one chunk of memory.
 */
function makeProbedStream(
  chunk: Uint8Array,
  maxChunks: number,
): { probe: StreamProbe; stream: ReadableStream<Uint8Array> } {
  const probe: StreamProbe = { cancelled: undefined, produced: 0, pulls: 0 }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (probe.pulls >= maxChunks) {
          controller.close()
          return
        }
        probe.pulls += 1
        probe.produced += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel(reason) {
        probe.cancelled = reason ?? true
      },
    },
    { highWaterMark: 0 },
  )
  return { stream, probe }
}

async function loadParseBody(): Promise<(event: unknown) => Promise<unknown>> {
  const route = await import('../../runtime/server/api/upload.post')
  const handler = route.default as {
    options: { parseBody: (event: unknown) => Promise<unknown> }
  }
  return handler.options.parseBody
}

describe('enforceUploadBodyByteCap', () => {
  it('aborts a web stream the moment the cap is passed and cancels the source', async () => {
    const chunk = new Uint8Array(4)
    const { stream, probe } = makeProbedStream(chunk, 1000)
    const event: CapEvent = { web: { request: { body: stream } } }

    await expect(enforceUploadBodyByteCap(event, 8)).rejects.toMatchObject({ statusCode: 413 })
    expect(probe.produced).toBeLessThanOrEqual(8 + chunk.byteLength)
    expect(probe.cancelled).toBeDefined()
    expect(event._requestBody).toBeUndefined()
  })

  it('accepts a web stream whose total is exactly the cap', async () => {
    const { stream, probe } = makeProbedStream(new Uint8Array(4), 2)
    const event: CapEvent = { web: { request: { body: stream } } }

    const body = (await enforceUploadBodyByteCap(event, 8)) as Uint8Array
    expect(body.byteLength).toBe(8)
    expect(probe.produced).toBe(8)
    expect(probe.cancelled).toBeUndefined()
    expect(event._requestBody).toBe(body)
  })

  it('rejects an already-materialised body above the cap before the parse', async () => {
    const event: CapEvent = { node: { req: { body: new Uint8Array(9) } } }

    await expect(enforceUploadBodyByteCap(event, 8)).rejects.toMatchObject({ statusCode: 413 })
  })

  it('passes a materialised body within the cap straight through', async () => {
    const body = new Uint8Array(8)
    const event: CapEvent = { node: { req: { body } } }

    await expect(enforceUploadBodyByteCap(event, 8)).resolves.toBe(body)
  })

  it('leaves a live node request stream to capIncomingMessageBytes', async () => {
    const req = new EventEmitter()
    const event: CapEvent = { node: { req } }

    await expect(enforceUploadBodyByteCap(event, 8)).resolves.toBeUndefined()
    expect(event._requestBody).toBeUndefined()
  })
})

describe('upload endpoint streamed body cap', () => {
  it('rejects a streamed body past the cap even when Content-Length is small', async () => {
    vi.resetModules()
    readMultipartFormData.mockReset()
    getHeader.mockReturnValue('1024')

    const chunk = new Uint8Array(26 * 1024 * 1024)
    const { stream, probe } = makeProbedStream(chunk, 1000)
    const event: CapEvent = { web: { request: { body: stream } } }

    const parseBody = await loadParseBody()
    await expect(parseBody(event)).rejects.toMatchObject({
      message: `Upload request exceeds ${MAX_UPLOAD_REQUEST_SIZE / 1024 / 1024}MB limit`,
      statusCode: 413,
    })
    expect(readMultipartFormData).not.toHaveBeenCalled()
    expect(probe.produced).toBeLessThanOrEqual(MAX_UPLOAD_REQUEST_SIZE + chunk.byteLength)
    expect(probe.cancelled).toBeDefined()
  })

  it('accepts a streamed body exactly at the cap and parses the bounded bytes', async () => {
    vi.resetModules()
    readMultipartFormData.mockReset()
    readMultipartFormData.mockResolvedValue([{ data: new Uint8Array(1), filename: 'a.png' }])
    getHeader.mockReturnValue(String(MAX_UPLOAD_REQUEST_SIZE))

    const { stream, probe } = makeProbedStream(new Uint8Array(MAX_UPLOAD_REQUEST_SIZE), 1)
    const event: CapEvent = { web: { request: { body: stream } } }

    const parseBody = await loadParseBody()
    await expect(parseBody(event)).resolves.toEqual([
      { data: expect.any(Uint8Array), filename: 'a.png' },
    ])
    expect(readMultipartFormData).toHaveBeenCalledTimes(1)
    expect(probe.produced).toBe(MAX_UPLOAD_REQUEST_SIZE)
    expect((event._requestBody as Uint8Array).byteLength).toBe(MAX_UPLOAD_REQUEST_SIZE)
  })

  it('rejects the Workers pre-buffered body above the cap before the parse', async () => {
    vi.resetModules()
    readMultipartFormData.mockReset()
    getHeader.mockReturnValue('1024')

    const event: CapEvent = {
      node: { req: { body: new Uint8Array(MAX_UPLOAD_REQUEST_SIZE + 1) } },
    }

    const parseBody = await loadParseBody()
    await expect(parseBody(event)).rejects.toMatchObject({
      message: `Upload request exceeds ${MAX_UPLOAD_REQUEST_SIZE / 1024 / 1024}MB limit`,
      statusCode: 413,
    })
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })

  it('rejects a streamed body with no Content-Length before reading a byte', async () => {
    vi.resetModules()
    readMultipartFormData.mockReset()
    getHeader.mockReturnValue(undefined)

    const { stream, probe } = makeProbedStream(new Uint8Array(4), 1000)
    const event: CapEvent = { web: { request: { body: stream } } }

    const parseBody = await loadParseBody()
    await expect(parseBody(event)).rejects.toMatchObject({
      message: 'Content-Length is required',
      statusCode: 411,
    })
    expect(probe.produced).toBe(0)
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })

  it('still hard-stops the live node request stream past the cap', async () => {
    vi.resetModules()
    readMultipartFormData.mockReset()
    readMultipartFormData.mockResolvedValue([{ data: new Uint8Array(1), filename: 'a.png' }])
    getHeader.mockReturnValue('1024')

    const req = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> }
    req.destroy = vi.fn()

    const parseBody = await loadParseBody()
    await expect(parseBody({ node: { req } })).resolves.toEqual([
      { data: expect.any(Uint8Array), filename: 'a.png' },
    ])

    req.emit('data', { byteLength: MAX_UPLOAD_REQUEST_SIZE + 1 })
    expect(req.destroy).toHaveBeenCalledTimes(1)
    expect(req.destroy.mock.calls[0]?.[0]).toMatchObject({ statusCode: 413 })
  })
})
