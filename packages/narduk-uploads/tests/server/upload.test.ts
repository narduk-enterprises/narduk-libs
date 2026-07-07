import { describe, expect, it, vi } from 'vitest'

import {
  ALLOWED_TYPES,
  CRITICAL_RASTER_WARNING_SIZE,
  getUploadPerformanceWarnings,
  MAX_FILE_SIZE,
  MAX_UPLOAD_REQUEST_SIZE,
  normalizeExtension,
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
