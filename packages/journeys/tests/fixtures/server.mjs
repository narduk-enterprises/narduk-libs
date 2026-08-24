import { createServer } from 'node:http'

/**
 * The fixture world: a tiny app with real buttons, a loader with scenario +
 * generation semantics, a world-fact API, and a /version. Just enough surface
 * for the adapter's whole contract to be exercised for real.
 */
export function createWorldServer() {
  let scenario = 'base'
  let generationCounter = 0
  let generation = 'ld-0'

  const page = (title, body) =>
    `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`

  const routes = {
    '/start': () => page('Start', '<button onclick="location.href=\'/step-two\'">Begin</button>'),
    '/step-two': () =>
      page(
        'Step two',
        '<p>The middle of the journey.</p><button onclick="location.href=\'/done\'">Finish</button>',
      ),
    '/done': () => page('Done', '<p>All done</p>'),
    '/extra': () => page('Extra', '<p>The extra room.</p>'),
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'POST' && url.pathname === '/load') {
      scenario = url.searchParams.get('scenario') ?? 'base'
      generationCounter += 1
      generation = `ld-${generationCounter}`
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ scenario, generation }))
      return
    }
    if (url.pathname === '/api/world.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ scenario, generation }))
      return
    }
    if (url.pathname === '/api/flag') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ showExtra: scenario === 'extra' }))
      return
    }
    if (url.pathname === '/version') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ revision: 'fixture-r1' }))
      return
    }
    if (url.pathname === '/api/html-fact') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(page('Sneaky', '<p>a rendered page pretending to be a fact</p>'))
      return
    }
    const html = routes[url.pathname]
    if (html) {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(html())
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
  })

  return {
    server,
    /** Replace the world out-of-band, as an interfering process would. */
    interfere() {
      generationCounter += 1
      generation = `ld-${generationCounter}`
    },
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          resolve(`http://127.0.0.1:${address.port}`)
        })
      })
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
