import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createEvent } from 'h3'
import { afterAll, beforeAll, vi } from 'vitest'

import { applyMigrationDirectory } from '../../narduk-core/tests/helpers/pg-schema-parity'
import {
  startPostgres17,
  type TestDatabase,
  type TestPostgres,
} from '../../narduk-core/tests/helpers/postgres17'

import {
  APP_URL,
  describeGoogleAndEmailLinkScenarios,
  type ScenarioContext,
} from './helpers/google-email-link-scenarios'

/**
 * Google sign-in and email sign-in links (narduk-libs#1951, #1952) on a real
 * PostgreSQL 17 (the stonx / Hyperdrive path). As in
 * `postgres-runtime.integration.test.ts`, narduk-core's real database module
 * runs against tables built from the shipped `drizzle-pg/*.sql`; only Nitro's
 * runtime config and Google (the fake issuer) are replaced.
 */

const runtime = vi.hoisted(() => ({ config: {} as Record<string, unknown> }))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: <T>(plugin: T) => plugin,
  useNitroApp: () => ({ hooks: { callHook: async () => {} } }),
  useRuntimeConfig: () => runtime.config,
}))
vi.mock('#layer/server/utils/database', async () => {
  return await import('../../narduk-core/runtime/server/utils/database')
})
vi.mock('#narduk-core/schema', async () => {
  return await import('../../narduk-core/runtime/server/database/pg-schema')
})
vi.mock('#narduk-auth/schema', async () => {
  return await import('../server/database/app-pg-schema')
})

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let server: TestPostgres
let database: TestDatabase
let context: ScenarioContext

beforeAll(async () => {
  process.env.NUXT_SESSION_PASSWORD = 'narduk-postgres-integration-session-password-32+chars'
  process.env.AUTH_EMAIL_SELF_SERVE_LINKS = 'true'
  process.env.AUTH_EMAIL_APP_URL = APP_URL
  server = await startPostgres17()
  database = await server.createDatabase()
  await applyMigrationDirectory(
    database.sql,
    join(PACKAGE_ROOT, '../narduk-core/runtime/drizzle-pg'),
  )
  await applyMigrationDirectory(database.sql, join(PACKAGE_ROOT, 'drizzle-pg'))
  runtime.config = {
    databaseBackend: 'postgres',
    databaseBackendSource: 'option',
    hyperdriveBinding: 'HYPERDRIVE',
    authBackend: 'local',
    authLocalEmailVerification: true,
    session: { name: 'nuxt-session' },
    public: {
      appName: 'Postgres test',
      appUrl: APP_URL,
      authBackend: 'local',
      authProviders: ['email'],
      authPublicSignup: true,
      authRequireMfa: false,
    },
  }
  const env: Record<string, string> = {}
  context = {
    backend: 'postgres',
    env,
    exec: async (sql) => {
      await database.sql.unsafe(sql)
    },
    modules: {
      emailFlow: await import('../server/lib/app-auth/local-email-flow'),
      emailSignIn: await import('../server/lib/app-auth/local-email-signin'),
      google: await import('../server/lib/app-auth/google-local'),
      googleIdentity: await import('../server/lib/app-auth/google-identity'),
    },
    query: async <T>(sql: string) => (await database.sql.unsafe(sql)) as unknown as T[],
    reset: async () => {
      await database.sql.unsafe(`TRUNCATE users, auth_local_email_attempts, auth_email_links,
        auth_identities CASCADE`)
    },
    visit: ({ cookie, path = '/api/auth/login' } = {}) => {
      const request = new IncomingMessage(new Socket())
      request.url = path
      request.method = 'POST'
      request.headers = { host: '127.0.0.1:3000', ...(cookie ? { cookie } : {}) }
      const event = createEvent(request, new ServerResponse(request))
      event.context.cloudflare = {
        env: { HYPERDRIVE: { connectionString: database.url }, ...env },
      }
      return event
    },
  }
}, 180_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await server?.stop()
})

describeGoogleAndEmailLinkScenarios(() => context)
