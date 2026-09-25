import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import exchangeGet from '../server/api/auth/session/exchange.get'
import exchangePost from '../server/api/auth/session/exchange.post'

import type { H3Event } from 'h3'

const RESET_PATH = '/reset-password'
const PARENT_EMAIL = 'parent@example.com'

interface UserRow {
  appleId?: string | null
  createdAt?: string
  email: string
  id: string
  isAdmin: boolean | null
  name: string | null
  passwordHash?: string | null
  updatedAt?: string
}

interface LinkRow {
  authUserId: string
  createdAt?: string
  emailConfirmedAt?: string | null
  lastProvider?: string | null
  localUserId: string
  primaryEmail: string
  providersJson?: string
  updatedAt?: string
}

interface QueryState {
  column?: string
  table?: string
  value?: unknown
}

const db = vi.hoisted(() => ({
  linkInserts: [] as LinkRow[],
  links: [] as LinkRow[],
  userInserts: [] as UserRow[],
  users: [] as UserRow[],
}))

const persistCalls = vi.hoisted(() => [] as Array<{ recoveryMode?: boolean }>)
const authConfig = vi.hoisted(() => ({ publicSignup: false }))
/** What the server-side PKCE exchange itself reports, independent of the client body. */
const exchangeResult = vi.hoisted(() => ({ redirectType: null as string | null }))
/** `invited_at` on the Supabase user a token_hash verifies to; null for a self-signup. */
const verifiedUser = vi.hoisted(() => ({ invitedAt: null as string | null }))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: <T>(plugin: T) => plugin,
  useRuntimeConfig: () => ({
    public: {
      authCallbackPath: '/auth/callback',
      authRedirectPath: '/dashboard/',
      authRequireMfa: false,
    },
  }),
}))

function drizzleName(table: unknown): string | undefined {
  if (!table || typeof table !== 'object') return undefined
  const symbol = Object.getOwnPropertySymbols(table).find(
    (entry) => entry.description === 'drizzle:Name',
  )
  if (!symbol) return undefined
  const value = (table as Record<symbol, unknown>)[symbol]
  return typeof value === 'string' ? value : undefined
}

function parseEq(clause: unknown): { column?: string; table?: string; value?: unknown } {
  if (!clause || typeof clause !== 'object' || !('queryChunks' in clause)) return {}
  const chunks = (clause as { queryChunks: unknown[] }).queryChunks
  let column: string | undefined
  let table: string | undefined
  let value: unknown
  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'name' in chunk && 'table' in chunk) {
      column = (chunk as { name: string }).name
      table = drizzleName((chunk as { table: unknown }).table)
    }
    if (chunk && typeof chunk === 'object' && 'value' in chunk && 'encoder' in chunk) {
      value = (chunk as { value: unknown }).value
    }
  }
  return { column, table, value }
}

function createChain(defaultTable?: string) {
  const state: QueryState = { table: defaultTable }
  const chain: Record<string, unknown> = { __q: state }
  chain.select = () => chain
  chain.from = (table: unknown) => {
    state.table = drizzleName(table) ?? state.table
    return chain
  }
  chain.insert = (table: unknown) => {
    state.table = drizzleName(table) ?? state.table
    return chain
  }
  chain.values = (row: Record<string, unknown>) => {
    if (state.table === 'users') {
      const user = row as unknown as UserRow
      db.userInserts.push(user)
      db.users.push(user)
    }
    if (state.table === 'auth_user_links') {
      const link = row as unknown as LinkRow
      db.linkInserts.push(link)
      db.links.push(link)
    }
    return chain
  }
  chain.where = (clause: unknown) => {
    const parsed = parseEq(clause)
    state.column = parsed.column
    state.value = parsed.value
    if (parsed.table) state.table = parsed.table
    return chain
  }
  chain.update = () => chain
  chain.set = () => chain
  chain.delete = () => chain
  return chain
}

function lookupRow(query: unknown): unknown {
  const state = (query as { __q?: QueryState }).__q
  if (!state) return undefined
  if (state.table === 'users') {
    if (state.column === 'id') return db.users.find((row) => row.id === state.value)
    if (state.column === 'email') return db.users.find((row) => row.email === state.value)
    if (state.column === 'apple_id') return db.users.find((row) => row.appleId === state.value)
  }
  if (state.table === 'auth_user_links') {
    if (state.column === 'auth_user_id') {
      return db.links.find((row) => row.authUserId === state.value)
    }
    if (state.column === 'local_user_id') {
      return db.links.find((row) => row.localUserId === state.value)
    }
  }
  return undefined
}

vi.mock('#layer/server/utils/database', () => ({
  createAppDatabase: () => () => createChain('auth_user_links'),
  executeDatabaseQuery: async () => {},
  getDatabaseRow: async (query: unknown) => lookupRow(query),
  getDatabaseRows: async (query: unknown) => {
    const row = lookupRow(query)
    return row ? [row] : []
  },
  useDatabase: () => createChain('users'),
}))

vi.mock('../server/lib/app-auth/session', () => ({
  persistSupabaseSession: async (_event: H3Event, params: { recoveryMode?: boolean }) => {
    persistCalls.push({ recoveryMode: params.recoveryMode })
    return {
      authSessionId: 'sess-1',
      aal: 'aal1',
      providers: ['email'],
      authProvider: 'email',
      emailConfirmedAt: null,
      needsPasswordSetup: false,
      recoveryMode: Boolean(params.recoveryMode),
    }
  },
  setCurrentSessionUser: vi.fn(),
  clearCurrentSession: vi.fn(),
  establishLocalSessionUser: vi.fn(),
  getCurrentSessionUser: vi.fn(),
  getCurrentSupabaseContext: vi.fn(),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({
    backend: 'supabase',
    publicSignup: authConfig.publicSignup,
    providers: ['apple'],
    appUrl: 'https://app.test',
    callbackPath: '/auth/callback',
    resetPath: RESET_PATH,
    redirectPath: '/dashboard/',
    confirmPath: '/auth/confirm',
  }),
  isSupabaseConfigured: () => true,
  createSupabaseUserClient: () => ({
    exchangeCodeForSession: async () => ({
      data: {
        redirectType: exchangeResult.redirectType,
        user: {
          id: 'auth-attacker',
          email: PARENT_EMAIL,
          app_metadata: {},
          user_metadata: {},
        },
        session: {
          access_token: 't',
          refresh_token: 'r',
          expires_in: 3600,
          user: { id: 'auth-attacker' },
        },
      },
      error: null,
    }),
    verifyOtp: async () => ({
      data: {
        user: {
          id: 'auth-invitee',
          email: PARENT_EMAIL,
          app_metadata: {},
          user_metadata: {},
          invited_at: verifiedUser.invitedAt ?? undefined,
        },
        session: {
          access_token: 't',
          refresh_token: 'r',
          expires_in: 3600,
          user: { id: 'auth-invitee' },
        },
      },
      error: null,
    }),
  }),
  createSupabaseClient: vi.fn(),
  toSupabaseHttpError: (error: unknown) => {
    throw error
  },
}))

vi.mock('#narduk-auth-server/utils/app-auth', async () => {
  const flows = await import('../server/lib/app-auth/auth-flows')
  return {
    exchangeSupabaseCode: flows.exchangeSupabaseCode,
  }
})

vi.mock('../server/utils/verified-email', () => ({
  getLocalEmailVerification: async () => null,
}))

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
  __options: { parseBody: (input: unknown) => unknown }
}

function captured(route: unknown): CapturedMutation {
  return route as unknown as CapturedMutation
}

function requestEvent(url: string, method = 'GET'): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = method
  request.url = url
  request.headers = { host: 'app.test' }
  const response = new ServerResponse(request)
  return createEvent(request, response)
}

async function postExchange(body: unknown) {
  const parsed = captured(exchangePost).__options.parseBody(body)
  return captured(exchangePost).__handler({
    body: parsed,
    event: requestEvent('/api/auth/session/exchange', 'POST'),
  })
}

describe('closed signup: client cannot forge invite or recovery on ?code=', () => {
  beforeEach(() => {
    db.users = []
    db.links = []
    db.userInserts = []
    db.linkInserts = []
    persistCalls.length = 0
    authConfig.publicSignup = false
    exchangeResult.redirectType = null
    verifiedUser.invitedAt = null
  })

  it('refuses POST {code, redirectType:"invite"} and does not INSERT a users row', async () => {
    await expect(postExchange({ code: 'pkce-code', redirectType: 'invite' })).rejects.toMatchObject(
      {
        statusCode: 403,
        statusMessage: 'Public signup is disabled for this app.',
      },
    )

    expect(db.userInserts).toEqual([])
    expect(db.users).toEqual([])
    expect(db.linkInserts).toEqual([])
    expect(persistCalls).toEqual([])
  })

  it('refuses GET ?code=&type=invite and does not INSERT a users row', async () => {
    const event = requestEvent('/api/auth/session/exchange?code=pkce-code&type=invite')
    await exchangeGet(event)

    expect(event.node.res.statusCode).toBe(302)
    expect(String(event.node.res.getHeader?.('location') ?? '')).toContain(
      'error=callback_exchange_failed',
    )
    expect(db.userInserts).toEqual([])
    expect(db.users).toEqual([])
    expect(db.linkInserts).toEqual([])
    expect(persistCalls).toEqual([])
  })

  it('refuses a self-signup confirmation token exchanged as type=invite', async () => {
    // GoTrue verifies a signup token as `invite` too; the user has no invited_at.
    await expect(
      postExchange({ tokenHash: 'signup-digest', verificationType: 'invite' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Public signup is disabled for this app.',
    })

    expect(db.userInserts).toEqual([])
    expect(db.linkInserts).toEqual([])
    expect(persistCalls).toEqual([])
  })

  it('refuses GET ?token_hash=&type=invite for a self-signup token', async () => {
    const event = requestEvent('/api/auth/session/exchange?token_hash=signup-digest&type=invite')
    await exchangeGet(event)

    expect(event.node.res.statusCode).toBe(302)
    expect(String(event.node.res.getHeader?.('location') ?? '')).toContain(
      'error=callback_exchange_failed',
    )
    expect(db.userInserts).toEqual([])
    expect(db.linkInserts).toEqual([])
  })

  it('refuses a PKCE exchange whose stored redirectType claims invite', async () => {
    // supabase-js reads `redirectType` back from the code-verifier storage,
    // which the client controls.
    exchangeResult.redirectType = 'invite'
    await expect(postExchange({ code: 'pkce-code' })).rejects.toMatchObject({ statusCode: 403 })

    expect(db.userInserts).toEqual([])
    expect(db.linkInserts).toEqual([])
  })

  it('still provisions a user an operator invited when the token_hash type is invite', async () => {
    verifiedUser.invitedAt = '2026-09-25T12:00:00Z'
    await postExchange({ tokenHash: 'digest', verificationType: 'invite' })

    expect(db.userInserts).toHaveLength(1)
    expect(db.userInserts[0]?.email).toBe(PARENT_EMAIL)
    expect(db.linkInserts).toHaveLength(1)
    expect(db.linkInserts[0]?.authUserId).toBe('auth-invitee')
    expect(persistCalls).toEqual([{ recoveryMode: false }])
  })

  it('does not link an unlinked local user via POST redirectType:"recovery"', async () => {
    db.users.push({
      id: 'local-1',
      email: PARENT_EMAIL,
      name: 'Parent',
      isAdmin: false,
    })

    await expect(
      postExchange({ code: 'pkce-code', redirectType: 'recovery' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Public signup is disabled for this app.',
    })

    expect(db.linkInserts).toEqual([])
    expect(db.links).toEqual([])
    expect(db.userInserts).toEqual([])
    expect(persistCalls).toEqual([])
  })

  it('refuses to insert a users row when recovery has no existing local account', async () => {
    authConfig.publicSignup = true

    await expect(
      postExchange({ tokenHash: 'digest', verificationType: 'recovery' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'This recovery link is not tied to an existing local account.',
    })

    expect(db.userInserts).toEqual([])
    expect(db.users).toEqual([])
    expect(db.linkInserts).toEqual([])
    expect(persistCalls).toEqual([])
  })

  it('does not stamp recovery_mode on a PKCE login that only deep-links to reset-password', async () => {
    db.users.push({
      id: 'local-1',
      email: PARENT_EMAIL,
      name: 'Parent',
      isAdmin: false,
    })
    db.links.push({
      authUserId: 'auth-attacker',
      localUserId: 'local-1',
      primaryEmail: PARENT_EMAIL,
    })

    await postExchange({ code: 'pkce-code', next: RESET_PATH })

    expect(persistCalls).toEqual([{ recoveryMode: false }])
    expect(db.userInserts).toEqual([])
    expect(db.linkInserts).toEqual([])
  })

  it('keeps recovery_mode when the client declares a non-recovery redirectType', async () => {
    exchangeResult.redirectType = 'recovery'
    db.users.push({
      id: 'local-1',
      email: PARENT_EMAIL,
      name: 'Parent',
      isAdmin: false,
    })
    db.links.push({
      authUserId: 'auth-attacker',
      localUserId: 'local-1',
      primaryEmail: PARENT_EMAIL,
    })

    await postExchange({ code: 'pkce-code', redirectType: 'magiclink' })

    expect(persistCalls).toEqual([{ recoveryMode: true }])
  })

  it('does not link an unlinked local user via POST next=/reset-password', async () => {
    db.users.push({
      id: 'local-1',
      email: PARENT_EMAIL,
      name: 'Parent',
      isAdmin: false,
    })

    await expect(postExchange({ code: 'pkce-code', next: RESET_PATH })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Public signup is disabled for this app.',
    })

    expect(db.linkInserts).toEqual([])
    expect(db.links).toEqual([])
    expect(db.userInserts).toEqual([])
    expect(persistCalls).toEqual([])
  })
})
