import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

/**
 * AUTH_REQUIRE_MFA only restricts Supabase sessions that are not aal2.
 * The local backend has no TOTP enroll/verify stack, so the flag is ignored
 * there — warn once at startup so operators are not surprised.
 */
export default defineNitroPlugin(() => {
  const config = useRuntimeConfig() as {
    authBackend?: unknown
    public?: { authBackend?: unknown; authRequireMfa?: unknown }
  }
  const backend = config.authBackend ?? config.public?.authBackend
  if (backend === 'supabase') return
  if (config.public?.authRequireMfa !== true) return

  globalThis.console.warn(
    '[narduk-auth] AUTH_REQUIRE_MFA is ignored on the local backend: there is no TOTP enroll/verify stack. The flag only restricts Supabase sessions whose auth_sessions.aal is not aal2.',
  )
})
