import { describe, expect, it } from 'vitest'

import { createResendClient } from '../src/email'
import { NotifyError } from '../src/errors'

interface Call {
  body: Record<string, unknown>
  headers: Record<string, string>
  url: string
}

function stubResend(response: () => Response | Promise<Response>): {
  calls: Call[]
  fetch: typeof fetch
} {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      return response()
    },
  }
}

const message = {
  from: 'MyBoat <alerts@mybo.at>',
  to: ' logan@example.com ',
  subject: 'Shore power lost',
  text: 'Tideye switched to inverter at 14:02.',
}

describe('Resend client', () => {
  it('posts the message to /emails with bearer auth and returns the id', async () => {
    const stub = stubResend(() => Response.json({ id: 'email-1' }))
    const client = createResendClient({ apiKey: 're_test_key', fetch: stub.fetch })
    const result = await client.send({
      ...message,
      html: '<p>Tideye switched to inverter.</p>',
      replyTo: 'support@mybo.at',
      cc: ['crew@example.com'],
      tags: [{ name: 'category', value: 'shore-power' }],
      headers: { 'List-Unsubscribe': '<https://mybo.at/u>' },
      idempotencyKey: 'alert-a-1',
    })
    expect(result).toEqual({ ok: true, status: 200, id: 'email-1', reason: null, retryable: false })
    expect(stub.calls).toEqual([
      {
        url: 'https://api.resend.com/emails',
        headers: {
          authorization: 'Bearer re_test_key',
          'content-type': 'application/json',
          'idempotency-key': 'alert-a-1',
        },
        body: {
          from: 'MyBoat <alerts@mybo.at>',
          to: ['logan@example.com'],
          subject: 'Shore power lost',
          text: 'Tideye switched to inverter at 14:02.',
          html: '<p>Tideye switched to inverter.</p>',
          cc: ['crew@example.com'],
          reply_to: ['support@mybo.at'],
          headers: { 'List-Unsubscribe': '<https://mybo.at/u>' },
          tags: [{ name: 'category', value: 'shore-power' }],
        },
      },
    ])
  })

  it.each([
    [
      422,
      { name: 'validation_error', message: 'bad from' },
      { reason: 'validation_error', retryable: false },
    ],
    [429, { name: 'rate_limit_exceeded' }, { reason: 'rate_limit_exceeded', retryable: true }],
    [500, null, { reason: 'http_500', retryable: true }],
  ])('maps Resend %i to a result', async (status, body, expected) => {
    const stub = stubResend(() => new Response(body ? JSON.stringify(body) : 'oops', { status }))
    const result = await createResendClient({ apiKey: 'k', fetch: stub.fetch }).send(message)
    expect(result).toEqual({ ok: false, status, id: null, ...expected })
  })

  it('reports a network failure as retryable and never puts the key in the result', async () => {
    const client = createResendClient({
      apiKey: 're_secret',
      fetch: () => Promise.reject(new Error('ECONNRESET')),
    })
    const result = await client.send(message)
    expect(result).toEqual({
      ok: false,
      status: 0,
      id: null,
      reason: 'TransportError',
      retryable: true,
    })
    expect(JSON.stringify(result)).not.toContain('re_secret')
  })

  it('refuses incomplete messages and a blank key before any request', async () => {
    const stub = stubResend(() => Response.json({ id: 'x' }))
    const client = createResendClient({ apiKey: 'k', fetch: stub.fetch, origin: 'https://stub' })
    for (const bad of [
      { ...message, to: [] },
      { ...message, from: ' ' },
      { ...message, subject: '' },
      { ...message, text: undefined },
    ]) {
      await expect(client.send(bad)).rejects.toBeInstanceOf(NotifyError)
    }
    expect(stub.calls).toHaveLength(0)
    expect(() => createResendClient({ apiKey: ' ' })).toThrow(/API key is required/u)
    await client.send(message)
    expect(stub.calls[0]?.url).toBe('https://stub/emails')
  })
})
