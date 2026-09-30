import { OAuthAuthorizationServer } from '@cloudflare/workers-oauth-provider'

import { MCP_OAUTH_REGISTER_PATH, MCP_OAUTH_TOKEN_PATH } from './config'
import { createD1KvNamespace } from './d1-kv'

import type { ResolvedMcpOAuthConfig } from './config'
import type { McpOAuthDatabase } from './d1-kv'
import type { OAuthHelpers, ValidatedAccessToken } from '@cloudflare/workers-oauth-provider'

export interface McpOAuthLogger {
  warn(message: string, data?: Record<string, unknown>): void
}

/** What a protected MCP route learns about a valid OAuth access token. */
export interface McpOAuthGrantProps {
  clientId: string
  clientName: string
  userId: string
}

interface ExecutionContextLike {
  passThroughOnException(): void
  props?: unknown
  waitUntil(promise: Promise<unknown>): void
}

const fallbackContext: ExecutionContextLike = {
  waitUntil(promise) {
    promise.catch(() => {})
  },
  passThroughOnException() {},
}

function quote(value: string): string {
  return value.replaceAll(/["\\]/gu, '')
}

/**
 * The MCP authorization server over one D1 database: RFC 8414 metadata, DCR,
 * CIMD, authorization code + PKCE (S256 only), refresh rotation, RFC 7009
 * revocation and audience-bound tokens, all from
 * `@cloudflare/workers-oauth-provider`. Pure: no h3, so tests drive it
 * directly against Miniflare D1.
 */
export function createMcpOAuth(options: {
  config: ResolvedMcpOAuthConfig
  db: McpOAuthDatabase
  logger?: McpOAuthLogger
}) {
  const { config } = options
  const kv = createD1KvNamespace(options.db)
  const env = { OAUTH_KV: kv }
  const server = new OAuthAuthorizationServer<typeof env>({
    issuer: config.issuer,
    resources: [config.resource],
    authorizeEndpoint: config.authorizeEndpoint,
    tokenEndpoint: `${config.issuer}${MCP_OAUTH_TOKEN_PATH}`,
    ...(config.dynamicClientRegistration
      ? { clientRegistrationEndpoint: `${config.issuer}${MCP_OAUTH_REGISTER_PATH}` }
      : {}),
    ...(config.scopes.length > 0 ? { scopesSupported: config.scopes } : {}),
    accessTokenTTL: config.accessTokenTtl,
    refreshTokenTTL: config.refreshTokenTtl,
    refreshTokenIdleTTL: config.refreshTokenIdleTtl,
    clientIdMetadataDocumentEnabled: config.clientIdMetadataDocuments,
    // Only the error code and the library's server-side reason: never a token,
    // code, or client-supplied description.
    onError: ({ code, status, internal }) => {
      options.logger?.warn('MCP OAuth error response', { code, status, internal })
    },
  })

  function protectedResourceMetadata() {
    return {
      resource: config.resource,
      authorization_servers: [config.issuer],
      ...(config.requiredScopes.length > 0 ? { scopes_supported: config.requiredScopes } : {}),
      bearer_methods_supported: ['header'],
      ...(config.resourceName ? { resource_name: config.resourceName } : {}),
    }
  }

  /** RFC 6750 / RFC 9728 challenge for a 401 (or a 403 `insufficient_scope`). */
  function challenge(input: { description?: string; error?: string; scopes?: string[] } = {}) {
    const scopes = input.scopes ?? config.requiredScopes
    const parts = [`Bearer resource_metadata="${config.resourceMetadataUrl}"`]
    if (input.error) parts.push(`error="${quote(input.error)}"`)
    if (input.description) parts.push(`error_description="${quote(input.description)}"`)
    if (scopes.length > 0) parts.push(`scope="${quote(scopes.join(' '))}"`)
    return parts.join(', ')
  }

  /**
   * Validate an access token for this server's one resource. `null` for an
   * unknown, expired, revoked or wrong-audience token.
   */
  async function validate(
    token: string,
    now = Math.floor(Date.now() / 1000),
  ): Promise<(ValidatedAccessToken<McpOAuthGrantProps> & { grantId: string }) | null> {
    const parts = token.split(':')
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null
    const result = await server.validateToken(config.resource, token, env)
    if (!result || result.audience !== config.resource || result.expiresAt <= now) return null
    return { ...result, grantId: parts[1]! }
  }

  return {
    config,
    env,
    kv,
    server,
    api: (): OAuthHelpers => server.getOAuthApi(env),
    fetch: (request: Request, ctx: ExecutionContextLike = fallbackContext) =>
      server.fetch(request, env, ctx as Parameters<typeof server.fetch>[2]),
    protectedResourceMetadata,
    challenge,
    validate,
  }
}

export type McpOAuth = ReturnType<typeof createMcpOAuth>

export {
  MCP_OAUTH_AS_METADATA_PATH,
  MCP_OAUTH_DEFAULTS,
  MCP_OAUTH_PRM_PATH,
  MCP_OAUTH_REGISTER_PATH,
  MCP_OAUTH_TOKEN_PATH,
  resolveMcpOAuthConfig,
} from './config'
export type { McpOAuthRuntimeConfig, ResolvedMcpOAuthConfig } from './config'
