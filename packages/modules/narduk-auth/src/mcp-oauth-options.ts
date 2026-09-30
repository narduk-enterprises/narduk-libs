// Build-time half of MCP OAuth: only the zod config, never the OAuth library
// (its `cloudflare:workers` import cannot load in Node module setup).
import { MCP_OAUTH_DEFAULTS, mcpOAuthRuntimeConfigSchema } from '../server/lib/mcp-oauth/config'

import type { McpOAuthRuntimeConfig } from '../server/lib/mcp-oauth/config'

/** `nardukAuth.mcpOAuth`: every field but `enabled` has a default. */
export type NardukAuthMcpOAuthOptions = Partial<McpOAuthRuntimeConfig>

/** Defaults applied and validated; an invalid option fails the build. */
export function resolveMcpOAuthModuleOptions(
  options: NardukAuthMcpOAuthOptions | undefined,
): McpOAuthRuntimeConfig {
  const parsed = mcpOAuthRuntimeConfigSchema.safeParse({ ...MCP_OAUTH_DEFAULTS, ...options })
  if (!parsed.success) {
    throw new Error(`[narduk-auth] nardukAuth.mcpOAuth is invalid: ${parsed.error.message}`)
  }
  const config = parsed.data
  const unknown = config.requiredScopes.filter((scope) => !config.scopes.includes(scope))
  if (unknown.length > 0) {
    throw new Error(
      `[narduk-auth] nardukAuth.mcpOAuth.requiredScopes must be listed in scopes: ${unknown.join(', ')}`,
    )
  }
  return config
}
