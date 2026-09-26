import { createServer } from 'node:http'

import { createApp, defineEventHandler, type H3Event, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import healthHandler from '../runtime/server/api/health.get'
import {
  normalizeSourceRevision,
  readWorkerIdentity,
} from '../runtime/server/utils/worker-identity'

const { state, logger } = vi.hoisted(() => {
  const logger = { error: vi.fn(), child: () => logger }
  return {
    state: { config: {} as Record<string, unknown> },
    logger,
  }
})

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => state.config }))
vi.mock('../runtime/server/utils/logger', () => ({ useLogger: () => logger }))
vi.mock('../runtime/server/utils/database', () => ({ probeDatabaseConnection: vi.fn() }))

const REVISION_HEADER = 'x-app-revision'
const WORKER_VERSION_HEADER = 'x-app-worker-version'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const VERSION = {
  id: '5b4c8d0e-1f2a-4b3c-9d8e-7f6a5b4c3d2e',
  tag: SHA,
  timestamp: '2026-09-25T00:00:00Z',
}

function eventWith(context: Record<string, unknown>): H3Event {
  return { context } as unknown as H3Event
}

beforeEach(() => {
  state.config = { public: { buildVersion: SHA.toUpperCase() } }
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__env__')
})

describe('readWorkerIdentity', () => {
  it('reads the version binding from event.context.cloudflare.env', () => {
    const identity = readWorkerIdentity(
      eventWith({ cloudflare: { env: { CF_VERSION_METADATA: VERSION } } }),
    )
    expect(identity).toEqual({ sourceRevision: SHA, workerVersion: VERSION })
  })

  it('reads the version binding from event.context._platform.cloudflare.env', () => {
    const identity = readWorkerIdentity(
      eventWith({ _platform: { cloudflare: { env: { CF_VERSION_METADATA: VERSION } } } }),
    )
    expect(identity.workerVersion).toEqual(VERSION)
  })

  it('takes the binding name as an option', () => {
    const event = eventWith({ cloudflare: { env: { WORKER_VERSION: { id: 'abc' } } } })
    expect(readWorkerIdentity(event).workerVersion).toBeNull()
    expect(readWorkerIdentity(event, { binding: 'WORKER_VERSION' }).workerVersion).toEqual({
      id: 'abc',
      tag: null,
      timestamp: null,
    })
  })

  it('reports null halves outside a Worker and for a non-SHA build version', () => {
    state.config = { public: { buildVersion: '1.4.0' } }
    expect(readWorkerIdentity(eventWith({}))).toEqual({
      sourceRevision: null,
      workerVersion: null,
    })
  })

  it('prefers an explicit sourceRevision option', () => {
    expect(readWorkerIdentity(eventWith({}), { sourceRevision: 'ABCDEF1' }).sourceRevision).toBe(
      'abcdef1',
    )
    expect(readWorkerIdentity(eventWith({}), { sourceRevision: null }).sourceRevision).toBeNull()
  })

  it('rejects a binding value without an id', () => {
    const event = eventWith({ cloudflare: { env: { CF_VERSION_METADATA: { tag: 'x' } } } })
    expect(readWorkerIdentity(event).workerVersion).toBeNull()
  })
})

describe('normalizeSourceRevision', () => {
  it.each([
    ['abc123', null],
    ['abcdef1', 'abcdef1'],
    [` ${SHA} `, SHA],
    [`${SHA}0`, null],
    ['not-a-sha', null],
    [42, null],
  ])('%j → %j', (input, expected) => {
    expect(normalizeSourceRevision(input)).toBe(expected)
  })
})

async function requestHealth(env: Record<string, unknown>) {
  const app = createApp()
    .use(
      defineEventHandler((event) => {
        event.context.cloudflare = { env }
      }),
    )
    .use(healthHandler)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    return {
      headers: response.headers,
      body: (await response.json()) as { data: Record<string, unknown> },
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

describe('/api/health deploy identity', () => {
  const base = { databaseBackend: 'none', databaseBackendSource: 'option' }

  it('adds no identity unless the app opts in', async () => {
    state.config = { ...base, public: { buildVersion: SHA } }
    const { headers, body } = await requestHealth({ CF_VERSION_METADATA: VERSION })
    expect(body.data).not.toHaveProperty('identity')
    expect(headers.get(REVISION_HEADER)).toBeNull()
  })

  it('stamps the configured headers and keeps the built-in checks', async () => {
    state.config = {
      ...base,
      public: { buildVersion: SHA },
      nardukHealth: {
        identity: {
          revisionHeader: REVISION_HEADER,
          workerVersionHeader: WORKER_VERSION_HEADER,
          body: true,
        },
      },
    }
    const { headers, body } = await requestHealth({ CF_VERSION_METADATA: VERSION })
    expect(headers.get(REVISION_HEADER)).toBe(SHA)
    expect(headers.get(WORKER_VERSION_HEADER)).toBe(VERSION.id)
    expect(body.data.status).toBe('ok')
    expect(body.data.checks).toHaveLength(2)
    expect(body.data.identity).toEqual({ sourceRevision: SHA, workerVersion: VERSION })
    expect(Object.keys(body.data).at(-1)).toBe('identity')
  })

  it('omits a header whose value is unknown and leaves the body alone without body: true', async () => {
    state.config = {
      ...base,
      public: { buildVersion: '1.0.0' },
      nardukHealth: {
        identity: { revisionHeader: REVISION_HEADER, workerVersionHeader: WORKER_VERSION_HEADER },
      },
    }
    const { headers, body } = await requestHealth({})
    expect(headers.get(REVISION_HEADER)).toBeNull()
    expect(headers.get(WORKER_VERSION_HEADER)).toBeNull()
    expect(body.data).not.toHaveProperty('identity')
  })
})
