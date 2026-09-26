/**
 * Whether an `auth_sessions` row is past its lifetime, on either backend
 * (narduk-libs#1043). The read paths and `getCurrentSupabaseContext` share it,
 * so no path can refresh a row the others refuse. It lives apart from
 * `session.ts` so tests that mock that module still get the real check.
 */
export function isAuthSessionRowExpired(
  row: { expiresAt: number },
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return row.expiresAt <= nowSeconds
}
