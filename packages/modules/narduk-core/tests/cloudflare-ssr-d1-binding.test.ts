/**
 * Nested Nitro SSR fetches lose `event.context.cloudflare.env` even when the
 * outer Worker request still has the D1 binding (narduk-libs#49). The page
 * can render a fallback and look green while the internal API 500s.
 *
 * Nitro's cloudflare-module handler stamps the Worker `env` on
 * `globalThis.__env__` before every fetch/scheduled/queue/email handler. The
 * env resolver falls back to it when the event carries no Cloudflare context,
 * so the nested event reaches the same D1. With neither set, it still fails
 * closed.
 *
 * The last block runs the real `worker-env.ts` inside workerd (Miniflare,
 * `nodejs_compat`) because the first attempt at this fix used
 * `AsyncLocalStorage.enterWith()`, which passed under Node and throws on
 * workerd. Node-only semantics must not be what proves this.
 */
import { readFileSync } from 'node:fs'

import { createEvent } from 'h3'
import ts from 'typescript'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import { kvCache } from '../runtime/server/database/schema'
import { useDatabase } from '../runtime/server/utils/database'
import { readCloudflareRuntimeEnv, readWorkerRuntimeEnv } from '../runtime/server/utils/worker-env'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ databaseBackend: 'd1' }),
}))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))

const MIGRATIONS_DIR = new URL('../runtime/drizzle', import.meta.url).pathname
const WORKER_ENV_SOURCE = new URL('../runtime/server/utils/worker-env.ts', import.meta.url)
const EXPIRES = 4_102_444_800
const MISSING_BINDING =
  'D1 database binding not available. Ensure DB is configured in wrangler.json.'

let harness: D1QueryHarness

function setIsolateEnv(env: unknown): void {
  Reflect.set(globalThis, '__env__', env)
}

function clearIsolateEnv(): void {
  Reflect.deleteProperty(globalThis, '__env__')
}

/** An H3 event with no Cloudflare context, as Nitro's `localFetch` builds one. */
function nestedEvent(): H3Event {
  const request = { headers: {}, method: 'GET', url: '/' } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  return createEvent(request, response)
}

describe('D1 binding across a Nitro internal SSR fetch (narduk-libs#49)', () => {
  beforeAll(async () => {
    harness = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
  })

  afterAll(async () => {
    await harness.dispose()
  })

  beforeEach(async () => {
    await harness.clearData()
    clearIsolateEnv()
  })

  afterEach(() => {
    clearIsolateEnv()
  })

  it('resolves DB from the Worker isolate env when the nested event has no Cloudflare context', async () => {
    setIsolateEnv({ DB: harness.raw })
    const nested = nestedEvent()
    expect(nested.context.cloudflare).toBeUndefined()

    expect(readWorkerRuntimeEnv(nested).DB).toBe(harness.raw)

    const db = useDatabase(nested)
    await db.insert(kvCache).values({ key: 'ssr', value: 'nested', expiresAt: EXPIRES }).run()
    const rows = await db.select().from(kvCache).all()
    expect(rows).toEqual([
      expect.objectContaining({ key: 'ssr', value: 'nested', expiresAt: EXPIRES }),
    ])
  })

  it('still fails closed when neither the event nor the isolate has a binding', () => {
    const nested = nestedEvent()
    expect(readWorkerRuntimeEnv(nested, {}).DB).toBeUndefined()
    expect(() => useDatabase(nested)).toThrow(
      expect.objectContaining({ statusCode: 500, message: MISSING_BINDING }),
    )
  })

  it('ignores a non-object isolate env', () => {
    setIsolateEnv('not-an-env')
    expect(readCloudflareRuntimeEnv(nestedEvent())).toEqual({})
  })

  it("prefers the event's own Cloudflare env over the isolate env", () => {
    const own = { DB: 'own-db' }
    setIsolateEnv({ DB: 'isolate-db' })

    const direct = nestedEvent()
    direct.context.cloudflare = { env: own }
    expect(readWorkerRuntimeEnv(direct, {}).DB).toBe('own-db')

    const platform = nestedEvent()
    platform.context._platform = { cloudflare: { env: own } }
    expect(readCloudflareRuntimeEnv(platform).DB).toBe('own-db')
  })

  it('does not consult the isolate env when no event is passed', () => {
    setIsolateEnv({ DB: harness.raw })
    expect(readWorkerRuntimeEnv(undefined, {}).DB).toBeUndefined()
  })

  it('serves the same fallback to readCloudflareRuntimeEnv (rate-limit bindings, status)', () => {
    const limiter = { limit: vi.fn() }
    setIsolateEnv({ RATE_LIMITER: limiter })
    expect(readCloudflareRuntimeEnv(nestedEvent()).RATE_LIMITER).toBe(limiter)
  })
})

describe('the same resolver inside workerd (Miniflare, nodejs_compat)', () => {
  it('reads DB on a nested event after the module handler stamps globalThis.__env__', async () => {
    const workerEnv = ts.transpileModule(readFileSync(WORKER_ENV_SOURCE, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const entry = `
      import { readWorkerRuntimeEnv } from './worker-env.js'
      export default {
        async fetch(request, env) {
          const nested = { context: {} }
          const before = readWorkerRuntimeEnv(nested, {}).DB === undefined
          // What nitropack's cloudflare _module-handler does on every fetch.
          globalThis.__env__ = env
          const db = readWorkerRuntimeEnv(nested, {}).DB
          const row = await db.prepare('select 7 as n').first()
          return Response.json({ before, n: row.n, same: db === env.DB })
        },
      }
    `
    const miniflare = await import('miniflare')
    const v4Options = {
      compatibilityDate: '2026-07-01',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      // The first module is the entrypoint.
      modules: [
        { type: 'ESModule', path: 'index.js', contents: entry },
        { type: 'ESModule', path: 'worker-env.js', contents: workerEnv },
      ],
    }
    // Same Miniflare 4/5 bridge as narduk-testkit's D1 harness.
    const { convertV4MiniflareOptions } = miniflare as {
      convertV4MiniflareOptions?: (options: typeof v4Options) => unknown
    }
    const runtime = new miniflare.Miniflare(
      (convertV4MiniflareOptions
        ? convertV4MiniflareOptions(v4Options)
        : v4Options) as ConstructorParameters<typeof miniflare.Miniflare>[0],
    )

    try {
      const response = await runtime.dispatchFetch('http://localhost/')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ before: true, n: 7, same: true })
    } finally {
      await runtime.dispose()
    }
  }, 30_000)
})
