import type { TenancyRole } from '../utils/roles'

/**
 * Resources are generic on purpose: this package stores a `kind` plus an opaque
 * `id` and never resolves either. The first consumer maps `kind: 'vessel'`.
 */
export interface TenancyResourceRef {
  kind: string
  id: string
}

/**
 * Users are referenced by opaque text ids owned by the consumer (narduk-core /
 * narduk-auth `users.id`). This package deliberately declares no foreign key
 * across that boundary and imports nothing from narduk-auth.
 */
export interface TenancyOrg {
  id: string
  slug: string
  name: string
  createdByUserId: string
  createdAt: number
  updatedAt: number
}

export interface TenancyMembership {
  id: string
  orgId: string
  userId: string
  role: TenancyRole
  createdAt: number
  updatedAt: number
}

export interface TenancyResourceRoleOverride {
  id: string
  orgId: string
  resourceKind: string
  resourceId: string
  userId: string
  role: TenancyRole
  createdAt: number
  updatedAt: number
}

export interface TenancyInvite {
  id: string
  orgId: string
  email: string
  role: TenancyRole
  resourceKind: string | null
  resourceId: string | null
  tokenHash: string
  invitedByUserId: string
  expiresAt: number
  acceptedAt: number | null
  acceptedByUserId: string | null
  revokedAt: number | null
  createdAt: number
}

export interface TenancySupportGrant {
  id: string
  orgId: string
  resourceKind: string | null
  resourceId: string | null
  granteeUserId: string
  scopeJson: string
  reason: string
  grantedByUserId: string
  expiresAt: number
  revokedAt: number | null
  createdAt: number
}

export interface TenancyAuditEvent {
  id: string
  orgId: string
  actorUserId: string | null
  action: string
  subjectKind: string
  subjectId: string
  detailsJson: string
  createdAt: number
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
