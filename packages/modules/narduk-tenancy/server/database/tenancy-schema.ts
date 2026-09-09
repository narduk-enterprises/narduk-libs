import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { TENANCY_ROLES } from '../../shared/utils/roles'

/**
 * Generic tenancy tables (narduk-libs#171, company-hq D-7).
 *
 * D1/SQLite dialect only; the hand-written migration in
 * `drizzle/0001_tenancy.sql` is the DDL that actually runs, and
 * `tests/schema-migration-parity.test.ts` keeps the two in agreement.
 *
 * Two deliberate shape choices, because the plan documents specify none:
 * - every timestamp is a millisecond epoch INTEGER, so the injectable `now()`
 *   clock in the service is the only time source and no column needs parsing;
 * - `user_id` columns are opaque text with no foreign key. The users table
 *   belongs to the consuming app (narduk-core / narduk-auth), and a published
 *   package must not declare a cross-package FK into it.
 */
export const tenancyOrgs = sqliteTable(
  'tenancy_orgs',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('tenancy_orgs_slug_idx').on(table.slug)],
)

export const tenancyMemberships = sqliteTable(
  'tenancy_memberships',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => tenancyOrgs.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role', { enum: TENANCY_ROLES }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('tenancy_memberships_org_user_idx').on(table.orgId, table.userId),
    index('tenancy_memberships_user_idx').on(table.userId),
  ],
)

/**
 * A per-resource role for one member. An override may only NARROW the org role;
 * `setResourceRoleOverride` rejects anything more privileged than the member's
 * org role, so no override can be an escalation path.
 */
export const tenancyResourceRoleOverrides = sqliteTable(
  'tenancy_resource_role_overrides',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => tenancyOrgs.id, { onDelete: 'cascade' }),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: TENANCY_ROLES }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('tenancy_resource_role_overrides_scope_idx').on(
      table.orgId,
      table.resourceKind,
      table.resourceId,
      table.userId,
    ),
    index('tenancy_resource_role_overrides_user_idx').on(table.orgId, table.userId),
  ],
)

/** Digest-only, single-use, TTL-bounded org invitations. */
export const tenancyInvites = sqliteTable(
  'tenancy_invites',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => tenancyOrgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: TENANCY_ROLES }).notNull(),
    resourceKind: text('resource_kind'),
    resourceId: text('resource_id'),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
    acceptedAt: integer('accepted_at'),
    acceptedByUserId: text('accepted_by_user_id'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('tenancy_invites_token_hash_idx').on(table.tokenHash),
    index('tenancy_invites_org_email_idx').on(table.orgId, table.email),
  ],
)

/**
 * Time-boxed, read-only diagnostic access (ADR-0010). Not a role: a grant has a
 * reason, a scope list, a granter, and a hard expiry the service enforces.
 */
export const tenancySupportGrants = sqliteTable(
  'tenancy_support_grants',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => tenancyOrgs.id, { onDelete: 'cascade' }),
    resourceKind: text('resource_kind'),
    resourceId: text('resource_id'),
    granteeUserId: text('grantee_user_id').notNull(),
    scopeJson: text('scope_json').notNull().default('[]'),
    reason: text('reason').notNull(),
    grantedByUserId: text('granted_by_user_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('tenancy_support_grants_org_grantee_idx').on(table.orgId, table.granteeUserId),
    index('tenancy_support_grants_expires_at_idx').on(table.expiresAt),
  ],
)

/** One row per mutation. `org_id` is plain text so a deleted org keeps its trail. */
export const tenancyAuditEvents = sqliteTable(
  'tenancy_audit_events',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    subjectKind: text('subject_kind').notNull(),
    subjectId: text('subject_id').notNull(),
    detailsJson: text('details_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('tenancy_audit_events_org_created_at_idx').on(table.orgId, table.createdAt)],
)

export type TenancyOrgRow = typeof tenancyOrgs.$inferSelect
export type TenancyMembershipRow = typeof tenancyMemberships.$inferSelect
export type TenancyResourceRoleOverrideRow = typeof tenancyResourceRoleOverrides.$inferSelect
export type TenancyInviteRow = typeof tenancyInvites.$inferSelect
export type TenancySupportGrantRow = typeof tenancySupportGrants.$inferSelect
export type TenancyAuditEventRow = typeof tenancyAuditEvents.$inferSelect
