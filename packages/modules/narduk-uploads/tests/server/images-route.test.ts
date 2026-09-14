import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn())
const getRouterParam = vi.hoisted(() => vi.fn(() => 'uploads/test.svg'))
const setResponseHeaders = vi.hoisted(() => vi.fn())

vi.mock('h3', () => ({
  createError: (input: { message?: string; statusCode?: number }) =>
    Object.assign(new Error(input.message), input),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam,
  setResponseHeaders,
}))

vi.mock('@narduk-enterprises/narduk-uploads/runtime/server/utils/r2', () => ({
  useR2: () => ({ get }),
}))

vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => createLogger(),
}))

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    debug: vi.fn(),
    warn: vi.fn(),
  }
  return logger
}

describe('uploaded image route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getRouterParam.mockReturnValue('uploads/test.svg')
  })

  it('blocks existing R2 SVG objects from rendering as first-party documents', async () => {
    get.mockResolvedValue({
      body: 'svg body',
      httpEtag: 'etag',
      httpMetadata: { contentType: 'image/svg+xml; charset=utf-8' },
    })
    const route = await import('../../runtime/server/routes/images/[...slug].get')

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: 'Unsupported image type',
      statusCode: 415,
    })
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('blocks SVG upload keys even when old R2 metadata is missing or wrong', async () => {
    get.mockResolvedValue({
      body: 'svg body',
      httpEtag: 'etag',
      httpMetadata: { contentType: 'application/octet-stream' },
    })
    const route = await import('../../runtime/server/routes/images/[...slug].get')

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: 'Unsupported image type',
      statusCode: 415,
    })
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('blocks non-upload keys before reading from R2', async () => {
    getRouterParam.mockReturnValue('private/test.png')
    const route = await import('../../runtime/server/routes/images/[...slug].get')

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: 'Image not found',
      statusCode: 404,
    })
    expect(get).not.toHaveBeenCalled()
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('continues serving raster image objects', async () => {
    getRouterParam.mockReturnValue('uploads/test.png')
    get.mockResolvedValue({
      body: 'png body',
      httpEtag: 'etag',
      httpMetadata: { contentType: 'image/png' },
    })
    const route = await import('../../runtime/server/routes/images/[...slug].get')

    await expect(route.default({} as never)).resolves.toBe('png body')
    expect(setResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
      }),
    )
  })
})
