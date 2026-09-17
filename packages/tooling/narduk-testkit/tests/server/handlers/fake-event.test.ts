import {
  getCookie,
  getHeader,
  getQuery,
  getRouterParam,
  readBody,
  readRawBody,
  send,
  setHeader,
  setResponseStatus,
} from 'h3'
import { describe, expect, it } from 'vitest'

import { createFakeEvent, readFakeEventResponse } from '../../../src/server/handlers/fake-event'

describe('createFakeEvent', () => {
  it('defaults to a bare GET /', () => {
    const event = createFakeEvent()
    expect(event.method).toBe('GET')
    expect(event.path).toBe('/')
  })

  it('uppercases a lowercase method', () => {
    const event = createFakeEvent({ method: 'post' })
    expect(event.method).toBe('POST')
  })

  it('merges query params with any query string already in path', () => {
    const event = createFakeEvent({
      path: '/api/buoys?existing=1',
      query: { page: 2, tag: ['a', 'b'] },
    })
    expect(getQuery(event)).toEqual({ existing: '1', page: '2', tag: ['a', 'b'] })
  })

  it('exposes params through getRouterParam', () => {
    const event = createFakeEvent({ params: { id: 'buoy-1' } })
    expect(getRouterParam(event, 'id')).toBe('buoy-1')
    expect(getRouterParam(event, 'missing')).toBeUndefined()
  })

  it('reads request headers case-insensitively', () => {
    const event = createFakeEvent({ headers: { 'X-Request-Id': 'abc' } })
    expect(getHeader(event, 'x-request-id')).toBe('abc')
  })

  it('serializes cookies into a Cookie header', () => {
    const event = createFakeEvent({ cookies: { session: 'xyz' } })
    expect(getCookie(event, 'session')).toBe('xyz')
  })

  it('does not overwrite an explicit cookie header with the cookies option', () => {
    const event = createFakeEvent({
      cookies: { session: 'ignored' },
      headers: { cookie: 'session=explicit' },
    })
    expect(getCookie(event, 'session')).toBe('explicit')
  })

  it('JSON-encodes a non-string body and defaults its content-type', async () => {
    const event = createFakeEvent({ body: { name: 'Buoy 12' }, method: 'POST' })
    expect(getHeader(event, 'content-type')).toBe('application/json')
    await expect(readBody(event)).resolves.toEqual({ name: 'Buoy 12' })
  })

  it('passes a string body through untouched', async () => {
    const event = createFakeEvent({
      body: 'raw text',
      headers: { 'content-type': 'text/plain' },
      method: 'POST',
    })
    await expect(readRawBody(event)).resolves.toBe('raw text')
  })

  it('resolves an absent body to undefined on a payload method, matching a real bodyless request', async () => {
    const event = createFakeEvent({ method: 'POST' })
    await expect(readRawBody(event)).resolves.toBeUndefined()
  })

  it('merges extra context fields', () => {
    const event = createFakeEvent({ context: { userId: 'u1' } })
    expect(event.context.userId).toBe('u1')
  })
})

describe('readFakeEventResponse', () => {
  it('reads back a response the handler wrote directly (setResponseStatus/setHeader/send)', async () => {
    const event = createFakeEvent()
    setResponseStatus(event, 201)
    setHeader(event, 'x-test', 'yes')
    await send(event, JSON.stringify({ ok: true }), 'application/json')

    const response = readFakeEventResponse(event)
    expect(response.status).toBe(201)
    expect(response.headers['x-test']).toBe('yes')
    expect(response.body).toEqual({ ok: true })
  })

  it('falls back to the handler return value when nothing was written to the response', () => {
    const event = createFakeEvent()
    const response = readFakeEventResponse(event, { fromReturn: true })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ fromReturn: true })
  })

  it('decodes a non-JSON written body as text', async () => {
    const event = createFakeEvent()
    await send(event, 'plain text', 'text/plain')

    expect(readFakeEventResponse(event).body).toBe('plain text')
  })
})
