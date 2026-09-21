/**
 * Serves the prerendered `.output/public` for the browser suite and local
 * review, with no network dependency (`nuxi preview` would `npx serve`).
 *
 *   node scripts/serve.mts [port]
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../.output/public')
const port = Number(process.argv[2] ?? process.env.PORT ?? 4317)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

function resolveFile(pathname: string): string | null {
  const candidate = normalize(join(root, decodeURIComponent(pathname)))
  if (!candidate.startsWith(root)) return null
  for (const file of [candidate, join(candidate, 'index.html'), `${candidate}.html`]) {
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  return null
}

if (!existsSync(root)) {
  console.error(`${root} does not exist: run \`pnpm run build\` first.`)
  process.exit(1)
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost')
  const file = resolveFile(pathname)
  const status = file ? 200 : 404
  const body = file ?? resolveFile('/404.html')
  response.writeHead(status, {
    'content-type': TYPES[extname(body ?? '')] ?? 'application/octet-stream',
  })
  if (body) createReadStream(body).pipe(response)
  else response.end('Not found')
}).listen(port, () => console.log(`Explorer at http://localhost:${port}`))
