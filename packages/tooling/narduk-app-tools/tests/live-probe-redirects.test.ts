import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createLiveProbe } from '../src/live-probe.js'

const cleanups: Array<() => Promise<void>> = []
const credentials = {
  'CF-Access-Client-ID': 'fixture-id',
  'CF-Access-Client-Secret': 'fixture-secret',
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  cleanups.push(
    () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()))
        server.closeAllConnections()
      }),
  )
  return `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
}

describe('live probe credential origin boundary', () => {
  it.each(['defaults', 'request'] as const)(
    'refuses a foreign-origin redirect before sending %s credentials there',
    async (source) => {
      let foreignRequests = 0
      const foreign = await serve((_request, response) => {
        foreignRequests += 1
        response.end('foreign')
      })
      const origin = await serve((_request, response) => {
        response.writeHead(302, { location: foreign })
        response.end()
      })
      const result = await createLiveProbe(source === 'defaults' ? { headers: credentials } : {})(
        origin,
        source === 'request' ? { headers: credentials } : {},
      )
      expect(result.error).toContain('cross-origin redirect')
      expect(foreignRequests).toBe(0)
      expect(JSON.stringify(result)).not.toContain('fixture-secret')
    },
  )

  it('keeps credentials on same-origin relative redirects and records the final URL', async () => {
    const seen: Array<string | string[] | undefined> = []
    const origin = await serve((request, response) => {
      seen.push(request.headers['cf-access-client-secret'])
      if (request.url === '/') response.writeHead(307, { location: '/canonical' })
      response.end('ok')
    })
    const result = await createLiveProbe({ headers: credentials })(origin, { readBody: true })
    expect(result).toMatchObject({
      status: 200,
      redirected: true,
      finalUrl: `${origin}/canonical`,
      body: 'ok',
    })
    expect(seen).toEqual(['fixture-secret', 'fixture-secret'])
  })

  it('bounds same-origin redirect loops', async () => {
    let requests = 0
    const origin = await serve((_request, response) => {
      requests += 1
      response.writeHead(302, { location: '/' })
      response.end()
    })
    const result = await createLiveProbe({ headers: credentials })(origin)
    expect(result.error).toContain('redirect limit')
    expect(requests).toBe(21)
  })

  it('returns the first 3xx when redirect is manual', async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(302, { location: '/new' })
      response.end()
    })
    const result = await createLiveProbe()(origin + '/old', { redirect: 'manual' })
    expect(result).toMatchObject({
      status: 302,
      redirected: true,
      finalUrl: `${origin}/new`,
    })
  })

  it('preserves ordinary cross-origin redirects when no caller headers are supplied', async () => {
    const foreign = await serve((_request, response) => response.end('ok'))
    const origin = await serve((_request, response) => {
      response.writeHead(302, { location: foreign })
      response.end()
    })
    const result = await createLiveProbe()(origin)
    expect(result).toMatchObject({ status: 200, redirected: true, finalUrl: `${foreign}/` })
  })
})
