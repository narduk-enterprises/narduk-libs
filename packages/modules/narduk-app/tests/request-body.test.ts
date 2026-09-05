import { Readable } from 'node:stream'

import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { readJsonBody, readQuery, readRawJsonBody } from '../src/server/request-body'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const REFUSALS = {
  incomplete: 'The app did not send everything this needs.',
  unreadable: 'The app sent something this could not read.',
  misasked: 'The app asked for this the wrong way.',
}

/**
 * An h3 event for a request that carries the given raw text as its body (or
 * no body at all when `body` is omitted) -- a real Node request object,
 * built the same way `@narduk-enterprises/narduk-core`'s own h3 tests build
 * one (`createEvent(request, response)`), not a structural mock.
 */
function makeEvent(options: {
  body?: string
  contentType?: string
  method?: string
  path?: string
}): H3Event {
  const body = options.body
  const headers: Record<string, string> = {
    'content-type': options.contentType ?? 'application/json',
  }
  // h3 only reads the request stream when Content-Length (or chunked
  // transfer-encoding) says there is something to read; a body-less request
  // carries neither, matching a real client that sends no body at all.
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body))

  const request = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(body)]), {
    headers,
    method: options.method ?? 'POST',
    url: options.path ?? '/api/x',
  }) as unknown as IncomingMessage

  const response = {
    end() {},
    setHeader() {},
  } as unknown as ServerResponse

  return createEvent(request, response)
}

describe('readRawJsonBody: an absent body is an empty one', () => {
  it('resolves {} for a request with no body at all', async () => {
    await expect(
      readRawJsonBody(makeEvent({}), { code: 'unreadable_body', message: 'x' }),
    ).resolves.toEqual({})
  })

  it('resolves {} for a request whose body is the literal 4 bytes "null"', async () => {
    await expect(
      readRawJsonBody(makeEvent({ body: 'null' }), { code: 'unreadable_body', message: 'x' }),
    ).resolves.toEqual({})
  })

  it('parses a real JSON body', async () => {
    await expect(
      readRawJsonBody(makeEvent({ body: '{"toStage":"queued"}' }), {
        code: 'unreadable_body',
        message: 'x',
      }),
    ).resolves.toEqual({ toStage: 'queued' })
  })

  it("refuses unparseable JSON with the caller-supplied sentence, not h3's own", async () => {
    await expect(
      readRawJsonBody(makeEvent({ body: '{not json' }), {
        code: 'unreadable_body',
        message: REFUSALS.unreadable,
      }),
    ).rejects.toMatchObject({
      data: { code: 'unreadable_body' },
      message: REFUSALS.unreadable,
      statusCode: 400,
    })
  })
})

describe('readJsonBody', () => {
  const allOptional = z.object({
    note: z.string().nullish(),
    toStage: z.enum(['queued', 'prefill']).optional(),
  })
  const needsAStation = z.object({
    station: z.enum(['A', 'B', 'C', 'D']),
  })

  it('accepts a body-less POST when every field is optional', async () => {
    await expect(readJsonBody(makeEvent({}), allOptional, REFUSALS)).resolves.toEqual({})
  })

  it('still refuses a body-less POST when a field is required', async () => {
    await expect(readJsonBody(makeEvent({}), needsAStation, REFUSALS)).rejects.toMatchObject({
      data: { code: 'invalid_body' },
      message: REFUSALS.incomplete,
      statusCode: 400,
    })
  })

  it('carries the Zod issues in data, never in the rendered message', async () => {
    try {
      await readJsonBody(makeEvent({}), needsAStation, REFUSALS)
      throw new Error('expected a refusal')
    } catch (err) {
      const data = (err as { data: { issues: Array<{ path: string }> } }).data
      expect((err as { message: string }).message).toBe(REFUSALS.incomplete)
      expect(data.issues).toEqual([{ message: expect.any(String), path: 'station' }])
    }
  })

  it('parses a well-formed body against the schema', async () => {
    await expect(
      readJsonBody(makeEvent({ body: '{"station":"B"}' }), needsAStation, REFUSALS),
    ).resolves.toEqual({
      station: 'B',
    })
  })
})

describe('readQuery', () => {
  const schema = z.object({ page: z.coerce.number().int().positive().optional() })

  it('parses an empty query string against an all-optional schema', async () => {
    await expect(readQuery(makeEvent({ path: '/api/x' }), schema, REFUSALS)).resolves.toEqual({})
  })

  it('parses a real query string', async () => {
    await expect(
      readQuery(makeEvent({ path: '/api/x?page=3' }), schema, REFUSALS),
    ).resolves.toEqual({ page: 3 })
  })

  it('refuses with a sentence, not the raw Zod issue array', async () => {
    const required = z.object({ station: z.enum(['A', 'B']) })
    await expect(
      readQuery(makeEvent({ path: '/api/x' }), required, REFUSALS),
    ).rejects.toMatchObject({
      data: { code: 'invalid_query' },
      message: REFUSALS.misasked,
      statusCode: 400,
    })
  })
})
