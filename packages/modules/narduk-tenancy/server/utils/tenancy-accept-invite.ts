import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'

import {
  tenancyAuditEvents,
  tenancyInvites,
  tenancyMemberships,
  tenancyResourceRoleOverrides,
} from '../database/tenancy-schema'

import { runTenancyBatch, sqlRoleRank } from './tenancy-atomic'

import type { TenancyInvite } from '../../shared/types/tenancy'
import type { TenancyDatabase } from './tenancy'
import type { BatchItem } from 'drizzle-orm/batch'

/**
 * The acceptance audit row is also a unique claim receipt. Every statement in
 * this transaction is conditional on that receipt, so a losing concurrent
 * caller cannot create/promote a membership or write an override. A failed
 * statement rolls back the claim as well as every side effect.
 */
export async function claimInviteMembership(
  db: TenancyDatabase,
  invite: TenancyInvite,
  userId: string,
  acceptedAt: number,
  nextId: () => string,
): Promise<boolean> {
  const receiptId = nextId()
  const membershipId = nextId()
  const claimed = sql`EXISTS (SELECT 1 FROM tenancy_audit_events WHERE id = ${receiptId})`
  const inviteScope = and(eq(tenancyInvites.id, invite.id), claimed)
  const text = (value: string, alias: string) => sql<string>`${value}`.as(alias)
  const timestamp = sql<number>`${acceptedAt}`
  const memberScope = and(
    eq(tenancyMemberships.orgId, tenancyInvites.orgId),
    eq(tenancyMemberships.userId, userId),
  )
  const promotes = sql`${sqlRoleRank(tenancyInvites.role)} > ${sqlRoleRank(tenancyMemberships.role)}`
  const incomingPromotes = sql`${sqlRoleRank(sql`excluded.role`)} > ${sqlRoleRank(tenancyMemberships.role)}`

  const claim = db
    .insert(tenancyAuditEvents)
    .select(
      db
        .select({
          id: text(receiptId, 'id'),
          orgId: tenancyInvites.orgId,
          actorUserId: text(userId, 'actor_user_id'),
          action: text('invite.accept', 'action'),
          subjectKind: text('invite', 'subject_kind'),
          subjectId: tenancyInvites.id,
          detailsJson:
            sql<string>`json_object('userId', ${userId}, 'role', ${tenancyInvites.role}, 'email', ${tenancyInvites.email})`.as(
              'details_json',
            ),
          createdAt: timestamp.as('created_at'),
        })
        .from(tenancyInvites)
        .where(
          and(
            eq(tenancyInvites.id, invite.id),
            isNull(tenancyInvites.acceptedAt),
            isNull(tenancyInvites.revokedAt),
            gt(tenancyInvites.expiresAt, acceptedAt),
          ),
        ),
    )
    .returning({ id: tenancyAuditEvents.id })

  const memberAudit = db
    .insert(tenancyAuditEvents)
    .select(
      db
        .select({
          id: text(nextId(), 'id'),
          orgId: tenancyInvites.orgId,
          actorUserId: text(userId, 'actor_user_id'),
          action:
            sql<string>`CASE WHEN ${tenancyMemberships.id} IS NULL THEN 'membership.add' ELSE 'membership.change' END`.as(
              'action',
            ),
          subjectKind: text('membership', 'subject_kind'),
          subjectId: sql<string>`coalesce(${tenancyMemberships.id}, ${membershipId})`.as(
            'subject_id',
          ),
          detailsJson:
            sql<string>`json_object('userId', ${userId}, 'from', ${tenancyMemberships.role}, 'to', ${tenancyInvites.role}, 'role', ${tenancyInvites.role})`.as(
              'details_json',
            ),
          createdAt: timestamp.as('created_at'),
        })
        .from(tenancyInvites)
        .leftJoin(tenancyMemberships, memberScope)
        .where(and(inviteScope, or(isNull(tenancyMemberships.id), promotes))),
    )
    .returning({ id: tenancyAuditEvents.id })

  const member = db
    .insert(tenancyMemberships)
    .select(
      db
        .select({
          id: text(membershipId, 'id'),
          orgId: tenancyInvites.orgId,
          userId: text(userId, 'user_id'),
          role: tenancyInvites.role,
          createdAt: timestamp.as('created_at'),
          updatedAt: timestamp.as('updated_at'),
        })
        .from(tenancyInvites)
        .where(inviteScope),
    )
    .onConflictDoUpdate({
      target: [tenancyMemberships.orgId, tenancyMemberships.userId],
      set: {
        role: sql`CASE WHEN ${incomingPromotes} THEN excluded.role ELSE ${tenancyMemberships.role} END`,
        updatedAt: sql`CASE WHEN ${incomingPromotes} THEN excluded.updated_at ELSE ${tenancyMemberships.updatedAt} END`,
      },
    })
    .returning({ id: tenancyMemberships.id })

  const statements: [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>] = [
    claim,
    memberAudit,
    member,
  ]
  if (invite.resourceKind && invite.resourceId) {
    const overrideId = nextId()
    const overrideScope = and(
      eq(tenancyResourceRoleOverrides.orgId, tenancyInvites.orgId),
      eq(tenancyResourceRoleOverrides.userId, userId),
      eq(tenancyResourceRoleOverrides.resourceKind, invite.resourceKind),
      eq(tenancyResourceRoleOverrides.resourceId, invite.resourceId),
    )
    statements.push(
      db
        .insert(tenancyAuditEvents)
        .select(
          db
            .select({
              id: text(nextId(), 'id'),
              orgId: tenancyInvites.orgId,
              actorUserId: text(userId, 'actor_user_id'),
              action: text('override.set', 'action'),
              subjectKind: text('resource_role_override', 'subject_kind'),
              subjectId:
                sql<string>`coalesce(${tenancyResourceRoleOverrides.id}, ${overrideId})`.as(
                  'subject_id',
                ),
              detailsJson:
                sql<string>`json_object('userId', ${userId}, 'resourceKind', ${invite.resourceKind}, 'resourceId', ${invite.resourceId}, 'role', ${tenancyInvites.role})`.as(
                  'details_json',
                ),
              createdAt: timestamp.as('created_at'),
            })
            .from(tenancyInvites)
            .leftJoin(tenancyResourceRoleOverrides, overrideScope)
            .where(inviteScope),
        )
        .returning({ id: tenancyAuditEvents.id }),
    )
    statements.push(
      db
        .insert(tenancyResourceRoleOverrides)
        .select(
          db
            .select({
              id: text(overrideId, 'id'),
              orgId: tenancyInvites.orgId,
              resourceKind: text(invite.resourceKind, 'resource_kind'),
              resourceId: text(invite.resourceId, 'resource_id'),
              userId: text(userId, 'user_id'),
              role: tenancyInvites.role,
              createdAt: timestamp.as('created_at'),
              updatedAt: timestamp.as('updated_at'),
            })
            .from(tenancyInvites)
            .where(inviteScope),
        )
        .onConflictDoUpdate({
          target: [
            tenancyResourceRoleOverrides.orgId,
            tenancyResourceRoleOverrides.resourceKind,
            tenancyResourceRoleOverrides.resourceId,
            tenancyResourceRoleOverrides.userId,
          ],
          set: { role: sql`excluded.role`, updatedAt: timestamp },
        })
        .returning({ id: tenancyResourceRoleOverrides.id }),
    )
  }
  statements.push(
    db
      .update(tenancyInvites)
      .set({ acceptedAt, acceptedByUserId: userId })
      .where(and(eq(tenancyInvites.id, invite.id), claimed))
      .returning({ id: tenancyInvites.id }),
  )

  const results = await runTenancyBatch(db, statements)
  return Array.isArray(results[0]) && results[0].length === 1
}
