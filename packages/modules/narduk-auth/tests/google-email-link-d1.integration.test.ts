import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'

import { createEvent } from 'h3'
import { afterAll, beforeAll, vi } from 'vitest'

import { createD1QueryHarness, type D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'

import {
  APP_URL,
  describeGoogleAndEmailLinkScenarios,
  type ScenarioContext,
} from './helpers/google-email-link-scenarios'

/**
 * Google sign-in and email sign-in links (narduk-libs#1951, #1952) on real D1
 * (Miniflare). narduk-core's real database module reads the `DB` binding, and
 * the tables come from core's `runtime/drizzle/*.sql` then this package's
 * `drizzle/*.sql` — including 0006's rebuild of `auth_email_links`. Only
 * Nitro's runtime config and Google (the fake issuer) are replaced.
 */

const runtime = vi.hoisted(() => ({ config: {} as Record<string, unknown> }))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: <T>(plugin: T) => plugin,
  useNitroApp: () => ({ hooks: { callHook: async () => {} } }),
  useRuntimeConfig: () => runtime.config,
}))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))
vi.mock('#layer/server/utils/database', async () => {
  return await import('../../narduk-core/runtime/server/utils/database')
})
vi.mock('#narduk-core/schema', async () => {
  return await import('../../narduk-core/runtime/server/database/schema')
})
vi.mock('#narduk-auth/schema', async () => {
  return await import('../server/database/app-schema')
})

const migrations = (dir: string, names: string[]) =>
  names.map((name) => fileURLToPath(new URL(`${dir}/${name}`, import.meta.url)))

let harness: D1QueryHarness
let context: ScenarioContext

beforeAll(async () => {
  process.env.NUXT_SESSION_PASSWORD = 'narduk-d1-integration-session-password-32+chars!!'
  process.env.AUTH_EMAIL_SELF_SERVE_LINKS = 'true'
  process.env.AUTH_EMAIL_APP_URL = APP_URL
  harness = await createD1QueryHarness({
    migrations: [
      ...migrations('../../narduk-core/runtime/drizzle', [
        '0000_initial_schema.sql',
        '0001_kv_cache.sql',
        '0002_api_keys.sql',
        '0003_notifications.sql',
        '0004_api_key_scopes.sql',
        '0005_system_prompts.sql',
        '0006_user_id_indexes.sql',
        '0007_api_key_hash_index.sql',
        '0008_api_key_revoked_at.sql',
      ]),
      ...migrations('../drizzle', [
        '0001_auth_bridge.sql',
        '0002_local_email_auth.sql',
        '0003_webauthn_credentials.sql',
        '0004_native_auth.sql',
        '0005_mcp_oauth.sql',
        '0006_identities_and_signin_links.sql',
      ]),
    ],
  })
  runtime.config = {
    databaseBackend: 'd1',
    authBackend: 'local',
    authLocalEmailVerification: true,
    session: { name: 'nuxt-session' },
    public: {
      appName: 'D1 test',
      appUrl: APP_URL,
      authBackend: 'local',
      authProviders: ['email'],
      authPublicSignup: true,
      authRequireMfa: false,
    },
  }
  const env: Record<string, string> = {}
  context = {
    backend: 'd1',
    env,
    exec: async (sql) => {
      await harness.raw.prepare(sql).run()
    },
    modules: {
      emailFlow: await import('../server/lib/app-auth/local-email-flow'),
      emailSignIn: await import('../server/lib/app-auth/local-email-signin'),
      google: await import('../server/lib/app-auth/google-local'),
      googleIdentity: await import('../server/lib/app-auth/google-identity'),
    },
    query: async <T>(sql: string) => (await harness.raw.prepare(sql).all<T>()).results,
    reset: () => harness.clearData(),
    visit: ({ cookie, path = '/api/auth/login' } = {}) => {
      const request = new IncomingMessage(new Socket())
      request.url = path
      request.method = 'POST'
      request.headers = { host: '127.0.0.1:3000', ...(cookie ? { cookie } : {}) }
      const event = createEvent(request, new ServerResponse(request))
      event.context.cloudflare = { env: { DB: harness.db, ...env } }
      return event
    },
  }
}, 60_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await harness?.dispose()
})

describeGoogleAndEmailLinkScenarios(() => context)
