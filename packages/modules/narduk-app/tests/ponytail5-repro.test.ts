import { Readable } from 'node:stream'

import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'

import { readRawJsonBody } from '../src/server/request-body'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

function makeEvent(body: string, contentType: string): H3Event {
  const buf = Buffer.from(body)
  const request = Object.assign(Readable.from([buf]), {
    headers: { 'content-type': contentType, 'content-length': String(buf.length) },
    method: 'POST',
    url: '/api/x',
  }) as unknown as IncomingMessage
  const response = { end() {}, setHeader() {} } as unknown as ServerResponse
  return createEvent(request, response)
}
const unreadable = { message: 'unreadable', code: 'unreadable_body' }

describe('ponytail5 #1 form post passes the JSON reader', () => {
  it('refuses application/x-www-form-urlencoded', async () => {
    await expect(
      readRawJsonBody(
        makeEvent('to=attacker&amount=100', 'application/x-www-form-urlencoded'),
        unreadable,
      ),
    ).rejects.toBeDefined()
  })
  it('refuses text/plain', async () => {
    await expect(
      readRawJsonBody(makeEvent('hello', 'text/plain'), unreadable),
    ).rejects.toBeDefined()
  })
})

describe('ponytail5 #2 no body size cap', () => {
  it('refuses a 2 MiB body', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) })
    const outcome = await readRawJsonBody(makeEvent(big, 'application/json'), unreadable).then(
      () => 'accepted 2 MiB body',
      () => 'refused',
    )
    expect(outcome).toBe('refused')
  })
})
