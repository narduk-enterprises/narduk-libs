import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'

import { type ClientIpOptions, getClientIp } from '../runtime/server/utils/client-ip'

const CLOUDFLARE_ADDRESS = '203.0.113.7'
const SPOOFED_ADDRESS = '9.9.9.9'

/** One request through a real h3 app, answering what `getClientIp` resolved. */
async function resolve(
  headers: Record<string, string>,
  options: ClientIpOptions = {},
): Promise<string | undefined> {
  const app = createApp().use(
    defineEventHandler((event) => ({ ip: getClientIp(event, options) ?? null })),
  )
  const response = await toWebHandler(app)(new Request('http://test.local/', { headers }))
  const body = (await response.json()) as { ip: string | null }
  return body.ip ?? undefined
}

describe('getClientIp', () => {
  it('reads cf-connecting-ip before anything else, even with trustForwardedFor on', async () => {
    const headers = {
      'cf-connecting-ip': CLOUDFLARE_ADDRESS,
      'x-forwarded-for': `${SPOOFED_ADDRESS}, ${CLOUDFLARE_ADDRESS}`,
    }
    expect(await resolve(headers)).toBe(CLOUDFLARE_ADDRESS)
    expect(await resolve(headers, { trustForwardedFor: true })).toBe(CLOUDFLARE_ADDRESS)
  })

  it('ignores x-forwarded-for by default', async () => {
    expect(await resolve({ 'x-forwarded-for': `${SPOOFED_ADDRESS}, 198.51.100.4` })).not.toBe(
      SPOOFED_ADDRESS,
    )
  })

  it('takes the first x-forwarded-for entry only when asked to', async () => {
    expect(
      await resolve(
        { 'x-forwarded-for': ` ${SPOOFED_ADDRESS} , 198.51.100.4` },
        { trustForwardedFor: true },
      ),
    ).toBe(SPOOFED_ADDRESS)
  })

  it('treats a blank Cloudflare header as absent', async () => {
    expect(
      await resolve(
        { 'cf-connecting-ip': '   ', 'x-forwarded-for': SPOOFED_ADDRESS },
        { trustForwardedFor: true },
      ),
    ).toBe(SPOOFED_ADDRESS)
  })
})
