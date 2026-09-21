/**
 * Serves the prerendered `.output/public` for the browser suite and local
 * review, with no network dependency (`nuxi preview` would `npx serve`).
 *
 *   node scripts/serve.mts [port]
 *
 * Local only: it binds 127.0.0.1. A request can never read outside the served
 * root: the decoded path must stay inside it by path segments (not by string
 * prefix), and the file's real path, after following any symlink, must too.
 * A malformed request gets a 400 and the server keeps serving.
 */
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

export const HOST = '127.0.0.1'

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

/** A regular file inside `root` for `pathname`, `null` for none, `'bad'` for a malformed path. */
export function resolveRequestFile(root: string, pathname: string): string | null | 'bad' {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return 'bad'
  }
  if (decoded.includes('\0')) return 'bad'
  const realRoot = realpathSync(root)
  const candidate = resolve(realRoot, `.${decoded.startsWith('/') ? '' : '/'}${decoded}`)
  if (!inside(realRoot, candidate)) return null
  for (const file of [candidate, join(candidate, 'index.html'), `${candidate}.html`]) {
    let real: string
    try {
      real = realpathSync(file)
    } catch {
      continue
    }
    if (!inside(realRoot, real)) continue
    try {
      if (statSync(real).isFile()) return real
    } catch {
      continue
    }
  }
  return null
}

export function createExplorerServer(root: string): Server {
  return createServer((request, response) => {
    let pathname: string
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad request')
      return
    }
    const file = resolveRequestFile(root, pathname)
    if (file === 'bad') {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad request')
      return
    }
    const body = file ?? resolveRequestFile(root, '/404.html')
    const status = file ? 200 : 404
    if (typeof body !== 'string') {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }
    const stream = createReadStream(body)
    stream.once('open', () => {
      response.writeHead(status, {
        'content-type': TYPES[extname(body)] ?? 'application/octet-stream',
      })
      stream.pipe(response)
    })
    stream.once('error', () => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('Read error')
    })
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../.output/public')
  const port = Number(process.argv[2] ?? process.env.PORT ?? 4317)
  try {
    statSync(root)
  } catch {
    console.error(`${root} does not exist: run \`pnpm run build\` first.`)
    process.exit(1)
  }
  createExplorerServer(root).listen(port, HOST, () =>
    console.log(`Explorer at http://${HOST}:${port}`),
  )
}
