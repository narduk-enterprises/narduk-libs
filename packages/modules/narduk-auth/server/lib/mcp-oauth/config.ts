import { z } from 'zod'

/** Where the protocol endpoints live on the issuer's origin. */
export const MCP_OAUTH_TOKEN_PATH = '/oauth/token'
export const MCP_OAUTH_REGISTER_PATH = '/oauth/register'
export const MCP_OAUTH_AS_METADATA_PATH = '/.well-known/oauth-authorization-server'
export const MCP_OAUTH_PRM_PATH = '/.well-known/oauth-protected-resource'

const DAY = 24 * 60 * 60

/** `runtimeConfig.authMcpOAuth`, written by the module from `nardukAuth.mcpOAuth`. */
export const mcpOAuthRuntimeConfigSchema = z.object({
  enabled: z.boolean(),
  /** Canonical issuer origin; defaults to `public.appUrl`'s origin. */
  issuer: z.string().optional(),
  /** Path of the protected MCP endpoint on the issuer's origin. */
  resourcePath: z.string().regex(/^\/[\w\-./]*$/u),
  resourceName: z.string().optional(),
  /** Every scope this server may grant (RFC 8414 `scopes_supported`). */
  scopes: z.array(z.string().regex(/^[\x21\x23-\x5B\x5D-\x7E]+$/u)),
  /** The baseline a client asks for first (RFC 9728 `scopes_supported`, 401 `scope`). */
  requiredScopes: z.array(z.string()),
  consentPath: z.string().regex(/^\/[\w\-./]*$/u),
  accessTokenTtl: z.number().int().min(60),
  refreshTokenTtl: z.number().int().min(60),
  refreshTokenIdleTtl: z.number().int().min(60),
  dynamicClientRegistration: z.boolean(),
  clientIdMetadataDocuments: z.boolean(),
})

export type McpOAuthRuntimeConfig = z.infer<typeof mcpOAuthRuntimeConfigSchema>

export const MCP_OAUTH_DEFAULTS: McpOAuthRuntimeConfig = {
  enabled: false,
  resourcePath: '/mcp',
  scopes: [],
  requiredScopes: [],
  consentPath: '/oauth/authorize',
  accessTokenTtl: 60 * 60,
  refreshTokenTtl: 180 * DAY,
  refreshTokenIdleTtl: 30 * DAY,
  dynamicClientRegistration: true,
  clientIdMetadataDocuments: true,
}

export interface ResolvedMcpOAuthConfig extends McpOAuthRuntimeConfig {
  authorizeEndpoint: string
  issuer: string
  /** Canonical resource URI and token audience, e.g. `https://example.com/mcp`. */
  resource: string
  resourceMetadataUrl: string
}

/** Loopback hosts may use http (local development); every other issuer must be https. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)
  )
}

export function resolveMcpOAuthConfig(
  raw: unknown,
  appUrl: string | undefined,
): ResolvedMcpOAuthConfig | null {
  const parsed = mcpOAuthRuntimeConfigSchema.safeParse({
    ...MCP_OAUTH_DEFAULTS,
    ...(raw as object),
  })
  if (!parsed.success) throw new Error(`nardukAuth.mcpOAuth is invalid: ${parsed.error.message}`)
  const config = parsed.data
  if (!config.enabled) return null
  const source = config.issuer || appUrl
  if (!source) throw new Error('nardukAuth.mcpOAuth needs an issuer or runtimeConfig.public.appUrl')
  const origin = new URL(source)
  if (
    origin.protocol !== 'https:' &&
    !(origin.protocol === 'http:' && isLoopbackHost(origin.hostname))
  ) {
    throw new Error('The MCP OAuth issuer must be https (http only on a loopback host)')
  }
  const issuer = origin.origin
  return {
    ...config,
    issuer,
    resource: `${issuer}${config.resourcePath}`,
    resourceMetadataUrl: `${issuer}${MCP_OAUTH_PRM_PATH}${config.resourcePath}`,
    authorizeEndpoint: `${issuer}${config.consentPath}`,
  }
}
