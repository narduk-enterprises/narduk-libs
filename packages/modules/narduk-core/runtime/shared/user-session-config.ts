/**
 * The layer session's cookie name and lifetime, shared by core's own session
 * reads and writes (`runtime/server/utils/user-session.ts`) and by the
 * `runtimeConfig.session` seed `nuxt-auth-utils` reads (`src/module.ts`).
 *
 * Both readers must agree. When they did not, `nuxt-auth-utils` (no `maxAge`)
 * kept accepting a replayed cookie that core had already refused as too old,
 * and served its user on `/api/_auth/session` (narduk-libs#1214).
 */
export const LAYER_USER_SESSION_NAME = 'nuxt-session'

export const DEFAULT_USER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
