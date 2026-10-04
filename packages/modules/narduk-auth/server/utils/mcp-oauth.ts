import { AuthorizationError } from '@cloudflare/workers-oauth-provider'
import {
  createError,
  getHeader,
  getRequestURL,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { useLogger } from '#layer/server/utils/logger'

import { loadAuthUserRow } from '../lib/app-auth/session'
import { createMcpOAuth, resolveMcpOAuthConfig } from '../lib/mcp-oauth/core'

import { useAuthBridgeDatabase } from './auth-bridge-database'

import type { McpOAuth, ResolvedMcpOAuthConfig } from '../lib/mcp-oauth/core'
import type { RunnerOAuthPolicy } from '../lib/mcp-oauth/runner-provider'
import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import type { H3Error, H3Event } from 'h3'

export type { McpOAuth, ResolvedMcpOAuthConfig }

/** The account a consent page or a connected app acts for. */
export interface McpOAuthUser {
  email: string
  id: string
  name: string | null
}

/** The client asking for access, as the consent page shows it. */
export interface McpOAuthClient {
  /** A Client ID Metadata Document client's verified domain; unset for a self-registered client. */
  domain?: string
  id: string
  name: string
}

/**
 * App-supplied rules for connected apps (register once from a Nitro plugin
 * with `defineMcpOAuthPolicy`).
 */
export interface McpOAuthPolicy {
  /** How a change made through this connection is attributed. Default: "<client> for <user>". */
  attribution?: (context: { clientId: string; clientName: string; user: McpOAuthUser }) => string
  /**
   * Whether this signed-in user may connect this client. Return a message to
   * refuse (shown on the consent page and sent to the client as
   * `access_denied`), or nothing to allow. Called when the consent page opens
   * and again on approval.
   */
  authorize?: (context: {
    client: McpOAuthClient
    event: H3Event
    scopes: string[]
    user: McpOAuthUser
  }) => string | undefined | Promise<string | undefined>
  /** Exact external runner policy. No default; read eligibility afresh per request. */
  runner?: Omit<RunnerOAuthPolicy, 'eligible'> & {
    eligible(subject: string, event: H3Event): Promise<boolean>
  }
}

let policy: McpOAuthPolicy = {}
let runnerAudiencePolicy: McpOAuthPolicy['runner']

/** Independent, opt-in runner audience. Never replaces the native app policy. */
export function defineRunnerMcpOAuthPolicy(next: NonNullable<McpOAuthPolicy['runner']>): void {
  runnerAudiencePolicy = next
}

/** Register the app's connected-app rules. Call once, from a Nitro plugin. */
export function defineMcpOAuthPolicy(next: McpOAuthPolicy): void {
  policy = next
}

export function mcpOAuthPolicy(): McpOAuthPolicy {
  return policy
}

export function defaultMcpOAuthAttribution(context: {
  clientName: string
  user: McpOAuthUser
}): string {
  const who = context.user.name?.trim() || context.user.email
  return `${context.clientName} for ${who}`
}

/** A caller authenticated by an MCP OAuth access token. */
export interface McpOAuthPrincipal {
  /** e.g. "Claude for Logan", for change logs and activity feeds. */
  attribution: string
  clientId: string
  clientName: string
  email: string
  expiresAt: number
  grantId: string
  method: 'mcp-oauth'
  name: string | null
  /** Granted scopes; the route decides what each one allows. */
  scopes: string[]
  userId: string
}

/** The resolved configuration, or `null` when the app has not enabled MCP OAuth. */
export function mcpOAuthConfig(event: H3Event): ResolvedMcpOAuthConfig | null {
  const config = useRuntimeConfig(event) as {
    authMcpOAuth?: unknown
    public?: { appUrl?: unknown }
  }
  const appUrl = typeof config.public?.appUrl === 'string' ? config.public.appUrl : undefined
  return resolveMcpOAuthConfig(config.authMcpOAuth ?? { enabled: false }, appUrl)
}

/** The authorization server for this request. 404 when MCP OAuth is not enabled. */
export function useMcpOAuth(event: H3Event): McpOAuth {
  const cached = event.context.nardukMcpOAuth as McpOAuth | undefined
  if (cached) return cached
  const config = mcpOAuthConfig(event)
  if (!config) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  const log = useLogger(event).child('McpOAuth')
  const external = config.resource !== `${config.issuer}${config.resourcePath}`
  if (external && !policy.runner)
    throw createError({ statusCode: 503, statusMessage: 'Runner OAuth policy unavailable' })
  const mcp = createMcpOAuth({
    db: useAuthBridgeDatabase(event),
    config,
    ...(external && policy.runner
      ? {
          runner: {
            ...policy.runner,
            eligible: (subject: string) => policy.runner!.eligible(subject, event),
          },
        }
      : {}),
    ...(runnerAudiencePolicy
      ? {
          runnerAudience: {
            ...runnerAudiencePolicy,
            eligible: (subject: string) => runnerAudiencePolicy!.eligible(subject, event),
          },
        }
      : {}),
    logger: { warn: (message, data) => log.warn(message, data) },
  })
  event.context.nardukMcpOAuth = mcp
  return mcp
}

/** The Worker execution context the library schedules background work on. */
export function mcpOAuthExecutionContext(event: H3Event) {
  const cloudflare = event.context.cloudflare as
    { context?: { waitUntil?: (promise: Promise<unknown>) => void } } | undefined
  const waitUntil = cloudflare?.context?.waitUntil?.bind(cloudflare.context)
  return {
    waitUntil(promise: Promise<unknown>) {
      if (waitUntil) waitUntil(promise)
      else promise.catch(() => {})
    },
    passThroughOnException() {},
  }
}

/**
 * The incoming request rebuilt on the issuer's origin, so the library's
 * endpoint matching sees the canonical URL whatever host the Worker answered on.
 */
export async function mcpOAuthWebRequest(event: H3Event, mcp: McpOAuth): Promise<Request> {
  const url = getRequestURL(event)
  const headers = new Headers()
  for (const name of ['accept', 'authorization', 'content-type', 'cookie', 'origin']) {
    const value = getHeader(event, name)
    if (value) headers.set(name, value)
  }
  const method = event.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(event, false)
  return new Request(`${mcp.config.issuer}${url.pathname}${url.search}`, {
    method,
    headers,
    ...(body ? { body: new Uint8Array(body) } : {}),
  })
}

/** Copy a library response (status, headers, body) onto the h3 response. */
export async function sendMcpOAuthResponse(event: H3Event, response: Response): Promise<string> {
  setResponseStatus(event, response.status)
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie') continue
    setResponseHeader(event, name, value)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) setResponseHeader(event, 'set-cookie', cookies)
  return response.text()
}

/**
 * A 401 with the RFC 9728 challenge an MCP client follows to sign in. Throw it
 * from a protected route when there is no usable credential.
 */
export function mcpOAuthUnauthorized(
  event: H3Event,
  input: { description?: string; error?: 'invalid_token' } = {},
): H3Error {
  const mcp = useMcpOAuth(event)
  setResponseHeader(event, 'WWW-Authenticate', mcp.challenge(input))
  return createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    message: input.description ?? 'Sign in to connect this app.',
  })
}

/** A 403 naming every scope the operation needs (MCP step-up). */
export function mcpOAuthInsufficientScope(event: H3Event, scopes: string[]): H3Error {
  const mcp = useMcpOAuth(event)
  setResponseHeader(
    event,
    'WWW-Authenticate',
    mcp.challenge({ error: 'insufficient_scope', scopes }),
  )
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: `This connection needs the ${scopes.join(', ')} permission.`,
  })
}

function bearer(event: H3Event): string | null {
  const header = getHeader(event, 'authorization')?.trim()
  const match = header ? /^bearer\s+(\S+)$/iu.exec(header) : null
  return match?.[1] ?? null
}

/**
 * The caller behind an MCP OAuth access token, or `null` when the request
 * carries none: no bearer at all, an API key (`nk_…`, left to `requireAuth`),
 * or an app without MCP OAuth. A bearer that is not a live token for this
 * resource throws the 401 challenge; it never falls back to a cookie session.
 */
export async function resolveMcpOAuthPrincipal(event: H3Event): Promise<McpOAuthPrincipal | null> {
  const cached = event.context.nardukMcpOAuthPrincipal as McpOAuthPrincipal | undefined
  if (cached) return cached
  const token = bearer(event)
  if (!token || token.startsWith('nk_') || !mcpOAuthConfig(event)) return null
  const mcp = useMcpOAuth(event)
  // External runner tokens can never become local application/operator credentials.
  if (mcp.config.resource !== `${mcp.config.issuer}${mcp.config.resourcePath}`) {
    throw mcpOAuthUnauthorized(event, { error: 'invalid_token' })
  }
  const valid = await mcp.validate(token)
  if (!valid) {
    throw mcpOAuthUnauthorized(event, {
      error: 'invalid_token',
      description: 'The access token is invalid or expired.',
    })
  }
  const row = await loadAuthUserRow(event, valid.userId)
  if (!row) {
    throw mcpOAuthUnauthorized(event, {
      error: 'invalid_token',
      description: 'The account behind this token no longer exists.',
    })
  }
  const user: McpOAuthUser = { id: row.id, email: row.email, name: row.name ?? null }
  const clientName = valid.props?.clientName || valid.clientId
  const principal: McpOAuthPrincipal = {
    method: 'mcp-oauth',
    userId: row.id,
    email: row.email,
    name: user.name,
    clientId: valid.clientId,
    clientName,
    grantId: valid.grantId,
    scopes: valid.scope,
    attribution: (policy.attribution ?? defaultMcpOAuthAttribution)({
      user,
      clientId: valid.clientId,
      clientName,
    }),
    expiresAt: valid.expiresAt,
  }
  event.context.nardukMcpOAuthPrincipal = principal
  return principal
}

/**
 * Every grant the user holds, across list pages. Cursor pagination is
 * sequential by nature; a family account holds a handful of grants.
 */
export async function listMcpOAuthGrants(event: H3Event, userId: string) {
  const api = useMcpOAuth(event).api()
  type Grant = Awaited<ReturnType<typeof api.listUserGrants>>['items'][number]
  const collect = async (cursor?: string): Promise<Grant[]> => {
    const page = await api.listUserGrants(userId, cursor ? { cursor } : {})
    return page.cursor ? [...page.items, ...(await collect(page.cursor))] : page.items
  }
  return collect()
}

/**
 * narduk-auth's own rules on a request the library already validated: PKCE
 * for every client (the library requires it only for public ones), and only
 * scopes this server advertises (an empty request gets `requiredScopes`).
 * Throws a redirectable `AuthorizationError`; returns the scopes to grant.
 */
export function assertMcpOAuthRequest(mcp: McpOAuth, request: AuthRequest): string[] {
  const fail = (code: 'invalid_request' | 'invalid_scope', description: string) =>
    new AuthorizationError(code, {
      description,
      redirectUri: request.redirectUri,
      state: request.state,
      issuer: request.issuer ?? mcp.config.issuer,
    })
  if (!request.codeChallenge || request.codeChallengeMethod !== 'S256') {
    throw fail('invalid_request', 'PKCE with S256 is required.')
  }
  const config =
    mcp.runnerConfig && request.resource === mcp.runnerConfig.resource
      ? mcp.runnerConfig
      : mcp.config
  if (request.resource && request.resource !== config.resource)
    throw fail('invalid_request', 'The app asked for an audience this site does not offer.')
  const scopes = request.scope.length > 0 ? request.scope : config.requiredScopes
  const unknown = scopes.filter((scope) => !config.scopes.includes(scope))
  if (unknown.length > 0)
    throw fail('invalid_scope', 'The app asked for a permission this site does not offer.')
  return [...new Set(scopes)]
}

/** Dispatch only after SDK audience/PKCE validation and per-resource scope validation. */
export async function authorizeMcpOAuthRequest(
  mcp: McpOAuth,
  request: AuthRequest,
  context: Parameters<NonNullable<McpOAuthPolicy['authorize']>>[0],
): Promise<string | undefined> {
  const scopes = assertMcpOAuthRequest(mcp, request)
  if (mcp.runnerConfig && request.resource === mcp.runnerConfig.resource) {
    const runner = runnerAudiencePolicy
    if (
      !runner ||
      context.user.id !== runner.subject ||
      context.client.id !== runner.clientId ||
      !scopes.includes('runner:transitions:read') ||
      !(await runner.eligible(context.user.id, context.event))
    )
      return 'This runner connection is not approved.'
    return undefined
  }
  return policy.authorize?.({ ...context, scopes })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const CONSENT_OWNER_TTL = 600

/** Remember which user opened a consent handle, so only they can decide it. */
export async function bindMcpOAuthConsent(mcp: McpOAuth, handle: string, userId: string) {
  await mcp.kv.put(`narduk-consent-owner:${await sha256Hex(handle)}`, userId, {
    expirationTtl: CONSENT_OWNER_TTL,
  })
}

export async function mcpOAuthConsentOwner(mcp: McpOAuth, handle: string): Promise<string | null> {
  const owner = await mcp.kv.get(`narduk-consent-owner:${await sha256Hex(handle)}`)
  return typeof owner === 'string' ? owner : null
}

/** Claim an authorization code once, atomically, before the library redeems it. */
export async function claimMcpOAuthCode(mcp: McpOAuth, code: string): Promise<boolean> {
  return mcp.kv.claimOnce(`narduk-code-claim:${await sha256Hex(code)}`, CONSENT_OWNER_TTL)
}
