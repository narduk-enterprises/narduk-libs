/**
 * Preserve `recovery_mode` on an existing row unless the caller sets it.
 * `?? false` would silently clear the flag on every persist that omitted it.
 */
export function resolvePersistedRecoveryMode(
  explicit: boolean | undefined,
  existing: boolean | null | undefined,
): boolean {
  return explicit ?? Boolean(existing)
}
