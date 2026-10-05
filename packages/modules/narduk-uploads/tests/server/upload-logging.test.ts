import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { MAX_UPLOAD_REQUEST_SIZE } from '../../runtime/server/utils/upload'

import type { H3Event } from 'h3'

/*
 * Upload and image records go through narduk-core's real request logger
 * (narduk-logging's sanitizer included) into a capturing sink, so these
 * assertions are about what an app's Worker actually writes.
 */

const sink = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  write(record: Record<string, unknown>) {
    this.records.push(record)
  },
}))
const uploadToR2 = vi.hoisted(() => vi.fn())
const r2Get = vi.hoisted(() => vi.fn())

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    nardukLogging: { sinks: [sink], level: 'debug', service: 'uploads-test' },
  }),
}))
vi.mock('#layer/server/utils/mutation', () => ({
  defineUserMutation: (options: unknown, handler: unknown) => ({ handler, options }),
}))
vi.mock('#layer/server/utils/rateLimit', () => ({
  RATE_LIMIT_POLICIES: { upload: { limit: 60, windowMs: 60_000 } },
}))
vi.mock('@narduk-enterprises/narduk-uploads/runtime/server/utils/r2', () => ({
  uploadToR2,
  useR2: () => ({ get: r2Get }),
}))

const UPLOAD_PATH = '/api/upload'
const PERSONAL_NAME = 'jane.doe@example.com-passport'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

interface Part {
  data: Uint8Array
  filename?: string
  type?: string
}
interface UploadRoute {
  handler: (input: { body: Part[]; event: H3Event }) => Promise<unknown>
  options: { parseBody: (event: H3Event) => Promise<unknown> }
}

function requestEvent(path: string, headers: Record<string, string> = {}): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = path.startsWith('/images') ? 'GET' : 'POST'
  request.url = path
  request.headers = headers
  const event = createEvent(request, new ServerResponse(request))
  event.context.matchedRoute = { path, handlers: {} } as never
  return event
}

async function uploadRoute(): Promise<UploadRoute> {
  return (await import('../../runtime/server/api/upload.post')).default as unknown as UploadRoute
}

function rejections() {
  return sink.records.filter((record) => record.message === '[Upload] Upload rejected')
}

beforeAll(async () => {
  // narduk-core resolves Nitro's runtime config through a dynamic import.
  await import('nitropack/runtime')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

afterEach(() => {
  sink.records.length = 0
  vi.clearAllMocks()
})

describe('upload rejection records', () => {
  it('records a missing and an oversized Content-Length with a stable reason', async () => {
    const route = await uploadRoute()

    await expect(route.options.parseBody(requestEvent(UPLOAD_PATH))).rejects.toMatchObject({
      statusCode: 411,
    })
    await expect(
      route.options.parseBody(
        requestEvent(UPLOAD_PATH, { 'content-length': String(MAX_UPLOAD_REQUEST_SIZE + 1) }),
      ),
    ).rejects.toMatchObject({ statusCode: 413 })

    expect(rejections()).toEqual([
      expect.objectContaining({
        level: 'warn',
        scope: 'Upload',
        data: { statusCode: 411, reason: 'content_length_missing' },
      }),
      expect.objectContaining({
        data: {
          statusCode: 413,
          reason: 'request_too_large',
          contentLength: MAX_UPLOAD_REQUEST_SIZE + 1,
        },
      }),
    ])
  })

  it('records an unsupported type and a failed sniff without the client file name', async () => {
    const route = await uploadRoute()
    const event = requestEvent(UPLOAD_PATH)

    await expect(
      route.handler({
        event,
        body: [{ data: PNG, filename: `${PERSONAL_NAME}.html`, type: 'Text/HTML; charset=x' }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      route.handler({
        event,
        body: [
          {
            data: new TextEncoder().encode('<svg/>'),
            filename: `${PERSONAL_NAME}.png`,
            type: 'image/png',
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 415 })

    expect(rejections().map((record) => record.data)).toEqual([
      { statusCode: 400, reason: 'unsupported_type', fileCount: 1, declaredType: 'text/html' },
      { statusCode: 415, reason: 'content_not_image', fileCount: 1, declaredType: 'image/png' },
    ])
    expect(uploadToR2).not.toHaveBeenCalled()
    expect(JSON.stringify(sink.records)).not.toContain('jane.doe')
  })

  it('records an oversized file with the limit it exceeded', async () => {
    const route = await uploadRoute()
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set(PNG)

    await expect(
      route.handler({
        event: requestEvent(UPLOAD_PATH),
        body: [{ data: big, filename: 'a.png', type: 'image/png' }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(rejections()[0]?.data).toEqual({
      statusCode: 400,
      reason: 'file_too_large',
      fileCount: 1,
      maxFileBytes: 10 * 1024 * 1024,
    })
  })
})

describe('upload storage records', () => {
  it('records a failed R2 write with a sanitized error and rethrows it', async () => {
    // A forged second log line in the message is flattened; production drops the stack.
    const failure = new Error('R2 put failed\n{"level":"info","message":"forged"}')
    uploadToR2.mockRejectedValueOnce(failure)
    const route = await uploadRoute()

    await expect(
      route.handler({
        event: requestEvent(UPLOAD_PATH),
        body: [{ data: PNG, filename: `${PERSONAL_NAME}.png`, type: 'image/png' }],
      }),
    ).rejects.toBe(failure)

    const record = sink.records.find(
      (entry) => entry.message === '[Upload] Upload storage write failed',
    )
    expect(record).toMatchObject({
      level: 'error',
      data: {
        contentType: 'image/png',
        sizeBytes: PNG.byteLength,
        storedCount: 0,
        key: expect.stringMatching(/^uploads\/.+\.png$/u),
      },
    })
    expect(record?.error).toEqual({
      name: 'Error',
      message: 'R2 put failed {"level":"info","message":"forged"}',
    })
    expect(JSON.stringify(sink.records)).not.toContain('jane.doe')
  })

  it('keeps the file name out of the performance-budget warning', async () => {
    const hero = new Uint8Array(400 * 1024)
    hero.set(PNG)
    const route = await uploadRoute()

    await route.handler({
      event: requestEvent(UPLOAD_PATH),
      body: [{ data: hero, filename: `hero-${PERSONAL_NAME}.png`, type: 'image/png' }],
    })

    const warning = sink.records.find(
      (entry) => entry.message === '[Upload] Uploaded image exceeds public performance budget',
    )
    expect(warning?.data).toMatchObject({ sizeBytes: hero.byteLength })
    expect(warning?.data).not.toHaveProperty('filename')
    expect(JSON.stringify(sink.records)).not.toContain('jane.doe')
  })

  it('records a failed R2 read on the image route', async () => {
    r2Get.mockRejectedValueOnce(new Error('R2 unavailable'))
    const route = (await import('../../runtime/server/routes/images/[...slug].get')).default
    const event = requestEvent('/images/uploads/a.png')
    event.context.params = { slug: 'uploads/a.png' }

    await expect(route(event)).rejects.toThrow('R2 unavailable')
    expect(sink.records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: '[Images] Image storage read failed',
        data: expect.objectContaining({ slug: 'uploads/a.png' }),
      }),
    )
  })
})
