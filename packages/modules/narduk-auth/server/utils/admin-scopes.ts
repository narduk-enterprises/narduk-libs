/**
 * API-key scopes for the narduk-auth admin routes (narduk-libs#918).
 *
 * `requireAdmin` accepts a bearer key whose owner is an admin, and
 * `requireAuthScopes` passes any key when a route names no scope. Without a
 * scope here, a key minted for something narrow (`scopes: []`,
 * `['registry:read']`) could list every account. Sessions are unaffected.
 * Changing a role takes no scope: it is session-only.
 */
export const AUTH_ADMIN_SCOPES = {
  usersRead: 'auth:admin:users:read',
} as const
