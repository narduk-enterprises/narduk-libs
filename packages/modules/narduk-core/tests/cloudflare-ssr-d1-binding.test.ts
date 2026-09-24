/**
 * Nested Nitro SSR fetches lose `event.context.cloudflare.env` even when the
 * outer Worker request still has the D1 binding (narduk-libs#49). The page
 * can render a fallback and look green while the internal API 500s.
 *
 * These cases drive the request-hook helper the cloudflare-module plugin
 * installs: an outer request captures the binding, a nested event that has
 * no Cloudflare context must still reach the same D1, and a request that
 * never saw a binding still fails closed.
 */
import { createEvent } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import { kvCache } from '../runtime/server/database/schema'
import cloudflareRequestEnvPlugin from '../runtime/server/plugins/00-cloudflare-request-env'
import {
  clearCloudflareRequestContext,
  isolateCloudflareRequestContext,
  preserveCloudflareRequestContext,
} from '../runtime/server/utils/cloudflare-request-env'
import { useDatabase } from '../runtime/server/utils/database'
import { readWorkerRuntimeEnv } from '../runtime/server/utils/worker-env'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ databaseBackend: 'd1' }),
  defineNitroPlugin: (plugin: unknown) => plugin,
}))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))

const MIGRATIONS_DIR = new URL('../runtime/drizzle', import.meta.url).pathname
const EXPIRES = 4_102_444_800
const MISSING_BINDING =
  'D1 database binding not available. Ensure DB is configured in wrangler.json.'

let harness: D1QueryHarness

function requestEvent(): H3Event {
  const request = { headers: {}, method: 'GET', url: '/' } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  return createEvent(request, response)
}

function outerEvent(): H3Event {
  const event = requestEvent()
  event.context.cloudflare = { env: { DB: harness.raw } }
  return event
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
    clearCloudflareRequestContext()
  })

  afterEach(() => {
    clearCloudflareRequestContext()
  })

  it('retains the outer D1 binding on a nested SSR request that has no Cloudflare context', async () => {
    await isolateCloudflareRequestContext(async () => {
      const outer = outerEvent()
      preserveCloudflareRequestContext(outer)

      const nested = requestEvent()
      expect(nested.context.cloudflare).toBeUndefined()
      preserveCloudflareRequestContext(nested)

      const env = readWorkerRuntimeEnv(nested)
      expect(env.DB).toBeDefined()

      const db = useDatabase(nested)
      await db.insert(kvCache).values({ key: 'ssr', value: 'nested', expiresAt: EXPIRES }).run()
      const row = await db.select().from(kvCache).all()
      expect(row).toEqual([
        expect.objectContaining({ key: 'ssr', value: 'nested', expiresAt: EXPIRES }),
      ])
    })
  })

  it('still fails closed when no request has captured a D1 binding', async () => {
    await isolateCloudflareRequestContext(() => {
      const nested = requestEvent()
      preserveCloudflareRequestContext(nested)
      expect(() => useDatabase(nested)).toThrow(
        expect.objectContaining({ statusCode: 500, message: MISSING_BINDING }),
      )
    })
  })

  it('installs the capture on Nitro request hooks so localFetch sees the outer env', async () => {
    await isolateCloudflareRequestContext(() => {
      let onRequest: ((event: H3Event) => void) | undefined
      cloudflareRequestEnvPlugin({
        hooks: {
          hook(name: string, handler: (event: H3Event) => void) {
            expect(name).toBe('request')
            onRequest = handler
          },
        },
      } as never)
      expect(onRequest).toBeTypeOf('function')

      onRequest?.(outerEvent())
      const nested = requestEvent()
      onRequest?.(nested)
      expect(
        (nested.context.cloudflare as { env?: { DB?: unknown } } | undefined)?.env?.DB,
      ).toBeDefined()
      expect(() => useDatabase(nested)).not.toThrow()
    })
  })
})
