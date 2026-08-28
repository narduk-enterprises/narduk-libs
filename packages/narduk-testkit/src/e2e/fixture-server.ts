import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

import type { IncomingHttpHeaders, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FixtureRequest {
  headers: IncomingHttpHeaders
  method: string
  url: URL
}

export interface FixtureResponse {
  /**
   * The response body. A string or `Uint8Array` is sent as-is; anything else is JSON-encoded.
   * Ignored when `file` is set.
   */
  body?: unknown
  /** A file under {@link StaticFixtureServerOptions.fixtures}, sent verbatim. */
  file?: string
  headers?: Record<string, string>
  status?: number
}

export type FixtureRoute =
  FixtureResponse | ((request: FixtureRequest) => FixtureResponse | Promise<FixtureResponse>)

export interface StaticFixtureServerOptions {
  /** Directory of BUILT assets — `dist/client`, `.output/public`, whatever the build emits. */
  assets: string
  /** Printed when the build is missing, so the failure names its own fix. */
  buildCommand?: string
  /** Directory that {@link FixtureResponse.file} values resolve against. Defaults to `assets`. */
  fixtures?: string
  /** Default `127.0.0.1`. Bind wider only on a machine you control. */
  host?: string
  /**
   * What to do when a path with an extension names a file that is not there. `shell` matches how
   * Cloudflare Workers Assets, Netlify and Vite preview behave; `404` is the honest answer and the
   * easier one to debug, because a missing chunk stops looking like a page. Default `shell`.
   */
  missingAsset?: '404' | 'shell'
  /** Default 0, meaning an ephemeral port — so parallel suites cannot collide. */
  port?: number
  /**
   * Path prefix (or key) to fixture. Matched against `pathname`: an exact key wins, otherwise the
   * longest key that prefixes the path. A path inside {@link scope} that matches nothing is
   * answered 501 rather than falling through to the shell.
   */
  routes?: Record<string, FixtureRoute>
  /** The prefix the 501 rule applies to. Default `/api/`. */
  scope?: string
  /** The HTML entry, served for `/` and for every extensionless path. Default `index.html`. */
  shell?: string
  /** Suppress the one-line startup log. Default false. */
  silent?: boolean
}

export interface ServedRequest {
  method: string
  path: string
  status: number
}

export interface StaticFixtureServer {
  close(): Promise<void>
  /** `http://host:port`, with the port actually bound. */
  readonly origin: string
  readonly port: number
  /** Everything the server has answered, in order. Useful in a failure message, and in its tests. */
  readonly requests: readonly ServedRequest[]
}

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve a request path inside a root, or return null if it escapes.
 *
 * `normalize` collapses `..` before the join, and the resolved path is then required to still be
 * under the root — belt and braces, because a static server that can be walked out of is a static
 * server that can read the machine it runs on.
 */
function safeJoin(root: string, pathname: string): string | null {
  const relative = normalize(decodeURIComponent(pathname))
    .replace(/^(?:\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '')
  const absolute = resolve(root, relative)
  const rootResolved = resolve(root)
  return absolute === rootResolved || absolute.startsWith(rootResolved + sep) ? absolute : null
}

/** An exact key wins; otherwise the longest key that prefixes the path. */
function matchRoute(routes: Record<string, FixtureRoute>, pathname: string): FixtureRoute | null {
  if (Object.prototype.hasOwnProperty.call(routes, pathname))
    return routes[pathname] as FixtureRoute
  const prefix = Object.keys(routes)
    .filter((key) => pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0]
  return prefix === undefined ? null : (routes[prefix] as FixtureRoute)
}

function encodeBody(value: unknown): { body: Uint8Array; contentType: string } {
  if (typeof value === 'string') {
    return { body: Buffer.from(value, 'utf8'), contentType: 'text/plain; charset=utf-8' }
  }
  if (value instanceof Uint8Array) return { body: value, contentType: 'application/octet-stream' }
  return {
    body: Buffer.from(JSON.stringify(value ?? null), 'utf8'),
    contentType: 'application/json; charset=utf-8',
  }
}

/**
 * A static server for an app's BUILT output, with recorded responses standing in for its API.
 *
 * WHY A SERVER RATHER THAN `page.route`. Both work, and interception is the lighter tool right up
 * until the app depends on how a real static host behaves. The rule that makes `/day/2026-08-29` a
 * deep link rather than a 404 — every extensionless path rewritten to the HTML entry — lives in
 * the host, not in the app, so a suite that intercepts fetches is proving the app works under a
 * host it will never be deployed to. Serving the real build over real HTTP means the module graph,
 * the CSS, the History API and the deep links all behave the way they will in production, and the
 * only thing replaced is the data.
 *
 * WHY AN UNRECORDED ENDPOINT IS 501 AND NOT A PLAUSIBLE EMPTY BODY. A fixture server that answers
 * `{}` or `[]` for a path nobody recorded produces a page that renders its empty state, and a spec
 * that then asserts happily against a screen the product does not have. Answering 501 with the
 * path in the body makes the gap loud at the moment it opens. Pair it with a spec-side guard that
 * fails on a 5xx from the API and an unrecorded navigation becomes impossible to miss.
 *
 * The port defaults to ephemeral. A fixed port is the reason two suites cannot run at once and the
 * reason a stale server from a killed run silently serves the next one an old build.
 *
 * ```ts
 * const server = await startStaticFixtureServer({
 *   assets: 'dist/client',
 *   buildCommand: 'pnpm run build',
 *   fixtures: 'tests/e2e/fixtures',
 *   routes: {
 *     '/api/overview': { file: 'overview.json' },
 *     '/api/items/': ({ url }) => ({ file: `item${url.pathname.split('/').pop()}.json` }),
 *   },
 * })
 * // server.origin -> http://127.0.0.1:53124
 * ```
 */
export async function startStaticFixtureServer(
  options: StaticFixtureServerOptions,
): Promise<StaticFixtureServer> {
  const assets = resolve(options.assets)
  const fixtures = resolve(options.fixtures ?? options.assets)
  const host = options.host ?? '127.0.0.1'
  const missingAsset = options.missingAsset ?? 'shell'
  const routes = options.routes ?? {}
  const scope = options.scope ?? '/api/'
  const shell = options.shell ?? 'index.html'
  const shellPath = join(assets, shell)

  /*
   * A missing build is a hard stop, not a wall of 404s. The whole claim of this harness is that it
   * drives the real bundle; running it against an absent or stale `dist/` proves nothing and looks
   * like a hundred unrelated failures.
   */
  if (!existsSync(shellPath)) {
    const fix = options.buildCommand ? ` Run \`${options.buildCommand}\` first.` : ''
    throw new Error(`No built app at ${assets}: ${shell} is missing.${fix}`)
  }

  const requests: ServedRequest[] = []

  const send = (
    response: ServerResponse,
    status: number,
    body: Uint8Array,
    contentType: string,
    headers: Record<string, string> = {},
  ): void => {
    response.writeHead(status, {
      'Cache-Control': 'no-store',
      'Content-Length': String(body.byteLength),
      'Content-Type': contentType,
      ...headers,
    })
    response.end(body)
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`)
    const method = request.method ?? 'GET'
    const record = (status: number): void => {
      requests.push({ method, path: `${url.pathname}${url.search}`, status })
    }

    void (async () => {
      const route = matchRoute(routes, url.pathname)
      if (route) {
        const result =
          typeof route === 'function'
            ? await route({ headers: request.headers, method, url })
            : route
        const status = result.status ?? 200
        if (result.file !== undefined) {
          const absolute = safeJoin(fixtures, result.file)
          if (!absolute || !existsSync(absolute)) {
            record(501)
            send(
              response,
              501,
              Buffer.from(
                JSON.stringify({
                  error: 'fixture_missing',
                  message: `No fixture file for ${url.pathname}: ${result.file}`,
                }),
                'utf8',
              ),
              'application/json; charset=utf-8',
            )
            return
          }
          record(status)
          send(response, status, readFileSync(absolute), mimeFor(absolute), result.headers)
          return
        }
        const encoded = encodeBody(result.body)
        record(status)
        send(response, status, encoded.body, encoded.contentType, result.headers)
        return
      }

      if (url.pathname.startsWith(scope)) {
        record(501)
        send(
          response,
          501,
          Buffer.from(
            JSON.stringify({
              error: 'not_recorded',
              message: `No fixture recorded for ${url.pathname}${url.search}`,
            }),
            'utf8',
          ),
          'application/json; charset=utf-8',
        )
        return
      }

      const sendShell = (): void => {
        record(200)
        send(response, 200, readFileSync(shellPath), 'text/html; charset=utf-8')
      }

      if (url.pathname === '/' || !url.pathname.includes('.')) {
        sendShell()
        return
      }
      const absolute = safeJoin(assets, url.pathname)
      if (!absolute || !existsSync(absolute)) {
        if (missingAsset === 'shell') {
          sendShell()
          return
        }
        record(404)
        send(response, 404, Buffer.from('Not found', 'utf8'), 'text/plain; charset=utf-8')
        return
      }
      record(200)
      send(response, 200, readFileSync(absolute), mimeFor(absolute))
    })().catch((error: unknown) => {
      record(500)
      send(
        response,
        500,
        Buffer.from(String(error instanceof Error ? error.stack : error), 'utf8'),
        'text/plain; charset=utf-8',
      )
    })
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(options.port ?? 0, host, () => {
      server.off('error', rejectPromise)
      resolvePromise()
    })
  })

  const port = (server.address() as AddressInfo).port
  const origin = `http://${host}:${port}`
  if (options.silent !== true) process.stdout.write(`fixture server on ${origin}\n`)

  return {
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.closeAllConnections()
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
      }),
    origin,
    port,
    requests,
  }
}
