import type { TenancyRole } from '../utils/roles'

/**
 * Resources are generic on purpose: this package stores a `kind` plus an opaque
 * `id` and never resolves either. The first consumer maps `kind: 'vessel'`.
 */
export interface TenancyResourceRef {
  id: string
  kind: string
}

/**
 * Users are referenced by opaque text ids owned by the consumer (narduk-core /
 * narduk-auth `users.id`). This package deliberately declares no foreign key
 * across that boundary and imports nothing from narduk-auth.
 */
export interface TenancyOrg {
  createdAt: number
  createdByUserId: string
  id: string
  name: string
  slug: string
  updatedAt: number
}

export interface TenancyMembership {
  createdAt: number
  id: string
  orgId: string
  role: TenancyRole
  updatedAt: number
  userId: string
}

export interface TenancyResourceRoleOverride {
  createdAt: number
  id: string
  orgId: string
  resourceId: string
  resourceKind: string
  role: TenancyRole
  updatedAt: number
  userId: string
}

export interface TenancyInvite {
  acceptedAt: number | null
  acceptedByUserId: string | null
  createdAt: number
  email: string
  expiresAt: number
  id: string
  invitedByUserId: string
  orgId: string
  resourceId: string | null
  resourceKind: string | null
  revokedAt: number | null
  role: TenancyRole
  tokenHash: string
}

export interface TenancySupportGrant {
  createdAt: number
  expiresAt: number
  grantedByUserId: string
  granteeUserId: string
  id: string
  orgId: string
  reason: string
  resourceId: string | null
  resourceKind: string | null
  revokedAt: number | null
  scopeJson: string
}

export interface TenancyAuditEvent {
  action: string
  actorUserId: string | null
  createdAt: number
  detailsJson: string
  id: string
  orgId: string
  subjectId: string
  subjectKind: string
}

/**
 * `source` is `'none'` when the user has no membership in the org. The role is
 * then `null`; a caller must not read `source` as proof of access.
 */
export interface TenancyRoleResolution {
  role: TenancyRole | null
  source: 'membership' | 'override' | 'none'
  supportGrant?: TenancySupportGrant
}

/**
 * Every mutation this package performs writes exactly one audit row with one of
 * these actions. There is deliberately no SQL CHECK on `tenancy_audit_events`
 * .action: migrations here are additive-only, and extending a CHECK constraint
 * in SQLite requires a table rebuild.
 */
export const TENANCY_AUDIT_ACTIONS = [
  'org.create',
  'membership.add',
  'membership.change',
  'membership.remove',
  'override.set',
  'override.clear',
  'invite.create',
  'invite.accept',
  'invite.revoke',
  'support_grant.create',
  'support_grant.revoke',
] as const

export type TenancyAuditAction = (typeof TENANCY_AUDIT_ACTIONS)[number]
