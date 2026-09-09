/**
 * The tenancy role vocabulary, ordered high privilege first.
 *
 * `support` is deliberately absent. Support access is a time-boxed, read-only
 * diagnostic grant (ADR-0010), never a role: a grant expires on its own and
 * carries a reason and an audit trail, and none of that survives being modelled
 * as a membership row.
 */
export const TENANCY_ROLES = ['owner', 'admin', 'operator', 'crew', 'viewer'] as const

export type TenancyRole = (typeof TENANCY_ROLES)[number]

/**
 * Higher number means more privilege. Derived from `TENANCY_ROLES` order so the
 * vocabulary has exactly one source of truth.
 */
const ROLE_RANK: Record<TenancyRole, number> = Object.fromEntries(
  TENANCY_ROLES.map((role, index) => [role, TENANCY_ROLES.length - index]),
) as Record<TenancyRole, number>

export function isTenancyRole(value: unknown): value is TenancyRole {
  return typeof value === 'string' && (TENANCY_ROLES as readonly string[]).includes(value)
}

export function roleRank(role: TenancyRole): number {
  return ROLE_RANK[role]
}

/** True when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: TenancyRole, minimum: TenancyRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

/** The less privileged of two roles. */
export function narrowerRole(left: TenancyRole, right: TenancyRole): TenancyRole {
  return ROLE_RANK[left] <= ROLE_RANK[right] ? left : right
}
