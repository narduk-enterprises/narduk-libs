import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'

import { narrowerRole, roleAtLeast, roleRank, type TenancyRole } from '../../shared/utils/roles'
import {
  tenancyAuditEvents,
  tenancyInvites,
  tenancyMemberships,
  tenancyOrgs,
  tenancyResourceRoleOverrides,
  tenancySupportGrants,
} from '../database/tenancy-schema'

import { claimInviteMembership } from './tenancy-accept-invite'
import { preservesAnOwner, runTenancyBatch } from './tenancy-atomic'
import { isTenancyUniqueConstraint, TenancyError } from './tenancy-error'

import type {
  TenancyAuditAction,
  TenancyAuditEvent,
  TenancyInvite,
  TenancyMembership,
  TenancyOrg,
  TenancyResourceRef,
  TenancyResourceRoleOverride,
  TenancyRoleResolution,
  TenancySupportGrant,
} from '../../shared/types/tenancy'
import type { SQL } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

/**
 * The database this service is written against: the D1-shaped drizzle surface
 * a Narduk app already has (`LayerDatabase` in narduk-core is exactly this
 * shape). Only the four query-builder entry points are required, so a consumer
 * may pass a drizzle database carrying any schema.
 *
 * Every call site awaits `.get()`/`.all()`/`.run()`, which makes the service
 * dialect-neutral in behaviour: the synchronous better-sqlite3 driver returns
 * values rather than promises and awaiting them is equivalent. Tests use that
 * driver behind one documented cast.
 */
export type TenancyDatabase = Pick<
  BaseSQLiteDatabase<'async', unknown>,
  'select' | 'insert' | 'update' | 'delete'
>

export interface TenancyServiceOptions {
  /** Primary-key generator. Defaults to `crypto.randomUUID()`. */
  idGenerator?: () => string
  /** Millisecond epoch clock. Injectable so tests own time. */
  now?: () => number
  /** Invite token generator. Defaults to 256 random bits, hex encoded. */
  tokenGenerator?: () => string
}

export const INVITE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SUPPORT_GRANT_MAX_TTL_SECONDS = 86_400
export const AUDIT_EVENTS_DEFAULT_LIMIT = 50
export const AUDIT_EVENTS_MAX_LIMIT = 200
export const SUPPORT_GRANT_LIST_MAX_LIMIT = 200

const ORG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u

/**
 * Explicitly `T | undefined` regardless of the project's index-access strictness,
 * so every "row missing" branch below narrows honestly.
 */
function first<T>(rows: T[]): T | undefined {
  return rows.at(0)
}

/**
 * A deliberately small address check: one `@`, a non-empty local part, and a
 * dotted domain. Written without a regex because the obvious one
 * (`[^\s@]+@[^\s@]+\.[^\s@]+`) backtracks super-linearly on hostile input.
 * Deliverability is the consumer's problem; this only rejects nonsense.
 */
function isEmailAddress(value: string): boolean {
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local = '', domain = ''] = parts
  if (local.length === 0 || domain.length < 3) return false
  if (domain.startsWith('.') || domain.endsWith('.') || !domain.includes('.')) return false
  return !/\s/u.test(value)
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new TenancyError('invalid', `${field} must not be empty.`)
  }
  return trimmed
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toHex(new Uint8Array(digest))
}

function defaultTokenGenerator(): string {
  // 256 bits, comfortably above the >=128-bit floor the invite contract states.
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
}

/**
 * The explicit actor for a mutation no user made, such as seeding, a
 * migration or platform tooling. Every mutation that takes `actorUserId`
 * requires either a user id or this marker, so a system call is always a
 * deliberate choice in the code and never the accident of a missing field
 * (narduk-libs#213). A system call is not ranked and is audited with a null
 * actor.
 *
 * It is a symbol, so no request body, query string or user id can ever equal
 * it. `Symbol.for` keeps it the same value if a bundle carries two copies of
 * this module.
 */
export const TENANCY_SYSTEM_ACTOR: unique symbol = Symbol.for(
  '@narduk-enterprises/narduk-tenancy/system-actor',
)

/** Who is making a mutation: a user id, or `TENANCY_SYSTEM_ACTOR`. */
export type TenancyActorId = string | typeof TENANCY_SYSTEM_ACTOR

/**
 * The acting user's id, or `undefined` for `TENANCY_SYSTEM_ACTOR`. Anything
 * else, a missing field or `null` included, is refused `invalid` rather than
 * read as a system call.
 */
function actingUserId(actorUserId: unknown): string | undefined {
  if (actorUserId === TENANCY_SYSTEM_ACTOR) return undefined
  if (typeof actorUserId === 'string' && actorUserId.trim().length > 0) return actorUserId
  throw new TenancyError(
    'invalid',
    'actorUserId is required: pass the acting user id, or TENANCY_SYSTEM_ACTOR for a system call.',
  )
}

/** An identified caller, with the org role the rank rule judges them by. */
interface TenancyActor {
  role: TenancyRole
  userId: string
}

/**
 * The rank rule (narduk-libs#213). An identified actor may grant a role, or
 * act on a member who holds one, only at or below their own org role. Nothing
 * outranks an owner, so only an owner can make, demote, remove or narrow an
 * owner, and nobody can raise their own role.
 *
 * It is a floor, not a hierarchy. Whether an admin may manage another admin is
 * the consumer's policy, and consumers answer it differently, so a route that
 * wants "strictly below" says so itself. What no consumer may allow, a missing
 * route check included, is a change above the actor's own standing.
 *
 * A system call names no actor, so there is nothing to rank.
 */
function requireRank(actor: TenancyActor | undefined, role: TenancyRole): void {
  if (!actor || roleAtLeast(actor.role, role)) return
  throw new TenancyError(
    'forbidden',
    `User ${actor.userId} (${actor.role}) may not grant, or act on a member who holds, ${role}.`,
  )
}

/**
 * The rank check's inputs, asserted again inside the membership write, the
 * same way the last-owner rule is: the member still holds the role the check
 * read, and an identified actor still holds theirs. Otherwise a promotion or
 * demotion landing between the check and the write would let an out-of-rank
 * change through, such as an admin demoting somebody who had just been made an
 * owner.
 */
function stillInRank(
  membership: TenancyMembership,
  actor: TenancyActor | undefined,
): SQL | undefined {
  return and(
    eq(tenancyMemberships.role, membership.role),
    actorStillInRank(membership.orgId, actor),
  )
}

/**
 * An identified actor still holds exactly the role the rank check read.
 *
 * The same assertion `stillInRank` makes, addressed by org and user rather
 * than by the membership row being written, so a write to the overrides or
 * invites table can carry it too (narduk-libs#537). A system call names no
 * actor and adds no predicate.
 */
function actorStillInRank(orgId: string, actor: TenancyActor | undefined): SQL | undefined {
  if (!actor) return undefined
  return sql`EXISTS (
    SELECT 1 FROM tenancy_memberships AS acting
    WHERE acting.org_id = ${orgId}
      AND acting.user_id = ${actor.userId}
      AND acting.role = ${actor.role}
  )`
}

/**
 * The member the rank check read still stands exactly as it read them: at that
 * role, or — for `addMember`, and for an override whose member was already
 * gone — still not a member at all. A membership appearing in the window is as
 * much a change as one moving, because the check that ranked nothing ranked it
 * against nobody.
 */
function memberStillAsRead(orgId: string, userId: string, role: TenancyRole | null): SQL {
  if (role === null) {
    return sql`NOT EXISTS (
      SELECT 1 FROM tenancy_memberships AS target
      WHERE target.org_id = ${orgId}
        AND target.user_id = ${userId}
    )`
  }
  return sql`EXISTS (
    SELECT 1 FROM tenancy_memberships AS target
    WHERE target.org_id = ${orgId}
      AND target.user_id = ${userId}
      AND target.role = ${role}
  )`
}

/**
 * Why a write guarded by the in-write rank predicate matched no row.
 *
 * Always `conflict`. Everything the guard asserts was already true when the
 * service read it — a missing org, a missing member and an out-of-rank actor
 * each have their own answer from that read — so the only way the predicate
 * fails is that one of them moved inside the window, which is a race the
 * caller retries rather than a state it can be told about (narduk-libs#537).
 */
function rankWriteConflict(orgId: string): TenancyError {
  return new TenancyError(
    'conflict',
    `A role in org ${orgId} changed while this change was being made.`,
  )
}

/** A literal column for an `INSERT … SELECT`, aliased to the column it fills. */
function sqlText(value: string, column: string) {
  return sql<string>`${value}`.as(column)
}

/** As `sqlText`, for the millisecond-epoch integer columns. */
function sqlNumber(value: number, column: string) {
  return sql<number>`${value}`.as(column)
}

export interface CreateOrgInput {
  createdByUserId: string
  name: string
  slug: string
}

export interface MemberInput {
  /**
   * The caller, required. A user id is ranked against that user's org role
   * (narduk-libs#213): the change is refused `forbidden` if it reaches above
   * it, or if they are not a member at all. `TENANCY_SYSTEM_ACTOR` marks a
   * system call, such as seeding or platform tooling, which is never ranked.
   */
  actorUserId: TenancyActorId
  orgId: string
  userId: string
}

export interface AddMemberInput extends MemberInput {
  role: TenancyRole
}

export interface ResourceRoleOverrideInput extends MemberInput {
  resource: TenancyResourceRef
  role: TenancyRole
}

export interface ClearResourceRoleOverrideInput extends MemberInput {
  resource: TenancyResourceRef
}

export interface ResolveRoleInput {
  orgId: string
  resource?: TenancyResourceRef
  userId: string
}

export interface CreateInviteInput {
  email: string
  /** Absolute millisecond epoch expiry. Takes precedence over `ttlMs`. */
  expiresAt?: number
  /** Always ranked: an inviter may invite at or below their own org role. */
  invitedByUserId: string
  orgId: string
  resource?: TenancyResourceRef
  role: TenancyRole
  ttlMs?: number
}

export interface AcceptInviteInput {
  token: string
  userId: string
  /** An address verified by the consumer's identity provider, never request-body proof. */
  verifiedEmail?: string
}

export interface AcceptInviteResult {
  alreadyAccepted: boolean
  invite: TenancyInvite
  membership: TenancyMembership
  override: TenancyResourceRoleOverride | null
}

export interface CreateSupportGrantInput {
  grantedByUserId: string
  granteeUserId: string
  orgId: string
  reason: string
  resource?: TenancyResourceRef
  scope?: readonly string[]
  ttlSeconds: number
}

export interface ListSupportGrantsInput {
  limit?: number
  orgId: string
  resource?: TenancyResourceRef
  userId?: string
}

export interface ListAuditEventsInput {
  /**
   * Millisecond epoch; returns events strictly older than this. To page, pass
   * the last row's `createdAt` here **and** its `id` as `beforeId`: one
   * mutation can write several rows at the same `createdAt`, and `before`
   * alone skips the rest of that group (narduk-libs#941).
   */
  before?: number
  /**
   * The last row's `id`, with `before` set to its `createdAt`. Also returns
   * the rows at exactly `before` that sort after it (`id` descending).
   * Ignored without `before`.
   */
  beforeId?: string
  limit?: number
  orgId: string
}

export interface TenancyService {
  acceptInvite: (input: AcceptInviteInput) => Promise<AcceptInviteResult>
  addMember: (input: AddMemberInput) => Promise<TenancyMembership>
  clearResourceRoleOverride: (input: ClearResourceRoleOverrideInput) => Promise<void>
  createInvite: (input: CreateInviteInput) => Promise<{ invite: TenancyInvite; token: string }>
  createOrg: (input: CreateOrgInput) => Promise<TenancyOrg>
  createSupportGrant: (input: CreateSupportGrantInput) => Promise<TenancySupportGrant>
  getOrg: (orgId: string) => Promise<TenancyOrg | null>
  listActiveSupportGrants: (input: ListSupportGrantsInput) => Promise<TenancySupportGrant[]>
  listAuditEvents: (input: ListAuditEventsInput) => Promise<TenancyAuditEvent[]>
  listOrgsForUser: (userId: string) => Promise<TenancyOrg[]>
  removeMember: (input: MemberInput) => Promise<void>
  resolveRole: (input: ResolveRoleInput) => Promise<TenancyRoleResolution>
  revokeInvite: (input: { actorUserId: TenancyActorId; inviteId: string }) => Promise<TenancyInvite>
  revokeSupportGrant: (input: {
    actorUserId: TenancyActorId
    grantId: string
  }) => Promise<TenancySupportGrant>
  setMemberRole: (input: AddMemberInput) => Promise<TenancyMembership>
  setResourceRoleOverride: (
    input: ResourceRoleOverrideInput,
  ) => Promise<TenancyResourceRoleOverride>
}

/**
 * Build the tenancy service over a caller-supplied database.
 *
 * Nothing here reads ambient request state, environment variables, or another
 * package's session: the consumer owns identity and passes user ids in.
 */

export function createTenancy(
  db: TenancyDatabase,
  options: TenancyServiceOptions = {},
): TenancyService {
  const now = options.now ?? (() => Date.now())
  const nextId = options.idGenerator ?? (() => globalThis.crypto.randomUUID())
  const nextToken = options.tokenGenerator ?? defaultTokenGenerator

  async function audit(input: {
    action: TenancyAuditAction
    actorUserId?: string | null
    details?: Record<string, unknown>
    orgId: string
    subjectId: string
    subjectKind: string
  }): Promise<void> {
    await db
      .insert(tenancyAuditEvents)
      .values({
        id: nextId(),
        orgId: input.orgId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        detailsJson: JSON.stringify(input.details ?? {}),
        createdAt: now(),
      })
      .run()
  }

  async function findOrg(orgId: string): Promise<TenancyOrg | undefined> {
    return first(
      await db.select().from(tenancyOrgs).where(eq(tenancyOrgs.id, orgId)).limit(1).all(),
    )
  }

  async function requireOrg(orgId: string): Promise<TenancyOrg> {
    const org = await findOrg(orgId)
    if (!org) throw new TenancyError('not_found', `Org ${orgId} does not exist.`)
    return org
  }

  async function findMembership(
    orgId: string,
    userId: string,
  ): Promise<TenancyMembership | undefined> {
    return first(
      await db
        .select()
        .from(tenancyMemberships)
        .where(and(eq(tenancyMemberships.orgId, orgId), eq(tenancyMemberships.userId, userId)))
        .limit(1)
        .all(),
    )
  }

  async function requireMembership(orgId: string, userId: string): Promise<TenancyMembership> {
    const membership = await findMembership(orgId, userId)
    if (!membership) {
      throw new TenancyError('not_found', `User ${userId} is not a member of org ${orgId}.`)
    }
    return membership
  }

  /**
   * An identified actor and their org role. The rank rule judges an actor by
   * their standing in the org, never by a role a resource override narrowed,
   * so somebody who is not a member holds no rank at all. They are refused
   * before anything about the org's members is read, so the answer tells a
   * stranger nothing about who belongs to it.
   */
  async function requireActor(orgId: string, userId: string): Promise<TenancyActor> {
    const membership = await findMembership(orgId, userId)
    if (!membership) {
      throw new TenancyError('forbidden', `User ${userId} is not a member of org ${orgId}.`)
    }
    return { userId, role: membership.role }
  }

  /**
   * As `requireActor`, but `TENANCY_SYSTEM_ACTOR` gets `undefined`. A missing
   * actor is refused, never taken for a system call.
   */
  async function resolveActor(
    orgId: string,
    actorUserId: TenancyActorId,
  ): Promise<TenancyActor | undefined> {
    const userId = actingUserId(actorUserId)
    return userId === undefined ? undefined : requireActor(orgId, userId)
  }

  /**
   * Why a membership write guarded by `stillInRank` matched no row. The
   * member left (`not_found`). A role the rank check read moved before the
   * write (`conflict`), so the caller retries and the check runs against the
   * new state. Or the write would have left the org without an owner.
   */
  async function membershipWriteRefusal(
    membership: TenancyMembership,
    actor: TenancyActor | undefined,
  ): Promise<TenancyError> {
    const { orgId, userId } = membership
    const current = await findMembership(orgId, userId)
    if (!current) {
      return new TenancyError('not_found', `User ${userId} is not a member of org ${orgId}.`)
    }
    const acting = actor ? await findMembership(orgId, actor.userId) : undefined
    if (current.role !== membership.role || (actor && acting?.role !== actor.role)) {
      return new TenancyError(
        'conflict',
        `A role in org ${orgId} changed while this change was being made.`,
      )
    }
    return new TenancyError('last_owner', `Org ${orgId} must keep at least one owner.`)
  }

  async function insertMembership(
    input: AddMemberInput,
    actor: TenancyActor | undefined,
  ): Promise<TenancyMembership> {
    const timestamp = now()
    const membership: TenancyMembership = {
      id: nextId(),
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    // The rank inputs asserted inside the INSERT, the way `setMemberRole`
    // asserts them inside its UPDATE (narduk-libs#537). The org still exists,
    // the actor still holds the role the check read, and the user is still not
    // a member. A demotion, or a concurrent add, landing in that window writes
    // nothing rather than admitting one change against roles as they were.
    const inserted = first(
      await db
        .insert(tenancyMemberships)
        .select(
          db
            .select({
              id: sqlText(membership.id, 'id'),
              orgId: sqlText(membership.orgId, 'org_id'),
              userId: sqlText(membership.userId, 'user_id'),
              role: sqlText(membership.role, 'role'),
              createdAt: sqlNumber(timestamp, 'created_at'),
              updatedAt: sqlNumber(timestamp, 'updated_at'),
            })
            .from(tenancyOrgs)
            .where(
              and(
                eq(tenancyOrgs.id, input.orgId),
                actorStillInRank(input.orgId, actor),
                memberStillAsRead(input.orgId, input.userId, null),
              ),
            ),
        )
        .returning({ id: tenancyMemberships.id })
        .all(),
    )
    if (!inserted) throw rankWriteConflict(input.orgId)
    await audit({
      orgId: input.orgId,
      actorUserId: actor?.userId,
      action: 'membership.add',
      subjectKind: 'membership',
      subjectId: membership.id,
      details: { userId: input.userId, role: input.role },
    })
    return membership
  }

  async function updateMembershipRole(
    membership: TenancyMembership,
    role: TenancyRole,
    actor: TenancyActor | undefined,
  ): Promise<TenancyMembership> {
    const updated = first(
      await db
        .update(tenancyMemberships)
        .set({ role, updatedAt: now() })
        .where(
          and(
            eq(tenancyMemberships.id, membership.id),
            stillInRank(membership, actor),
            role === 'owner' ? undefined : preservesAnOwner(membership.orgId, membership.userId),
          ),
        )
        .returning()
        .all(),
    )
    if (!updated) throw await membershipWriteRefusal(membership, actor)
    await audit({
      orgId: membership.orgId,
      actorUserId: actor?.userId,
      action: 'membership.change',
      subjectKind: 'membership',
      subjectId: membership.id,
      details: { userId: membership.userId, from: membership.role, to: role },
    })
    return updated
  }

  async function findOverride(
    orgId: string,
    userId: string,
    resource: TenancyResourceRef,
  ): Promise<TenancyResourceRoleOverride | undefined> {
    return first(
      await db
        .select()
        .from(tenancyResourceRoleOverrides)
        .where(
          and(
            eq(tenancyResourceRoleOverrides.orgId, orgId),
            eq(tenancyResourceRoleOverrides.userId, userId),
            eq(tenancyResourceRoleOverrides.resourceKind, resource.kind),
            eq(tenancyResourceRoleOverrides.resourceId, resource.id),
          ),
        )
        .limit(1)
        .all(),
    )
  }

  async function upsertOverride(
    input: ResourceRoleOverrideInput,
    membership: TenancyMembership,
    actor: TenancyActor | undefined,
  ): Promise<TenancyResourceRoleOverride> {
    // Narrow-only: an override may lower a member's role on one resource and
    // may repeat it, but it may never be an escalation path.
    if (roleRank(input.role) > roleRank(membership.role)) {
      throw new TenancyError(
        'invalid',
        `An override may only narrow the org role (${membership.role}); ${input.role} is higher.`,
      )
    }

    const existing = await findOverride(input.orgId, input.userId, input.resource)
    const timestamp = now()
    const override: TenancyResourceRoleOverride = existing
      ? { ...existing, role: input.role, updatedAt: timestamp }
      : {
          id: nextId(),
          orgId: input.orgId,
          resourceKind: input.resource.kind,
          resourceId: input.resource.id,
          userId: input.userId,
          role: input.role,
          createdAt: timestamp,
          updatedAt: timestamp,
        }

    // Both branches carry the rank inputs into the write itself: the actor
    // still holds the role the check read, and the member still holds the org
    // role the override is capped by (narduk-libs#537). An admin whose target
    // is promoted to owner in that window narrows nobody.
    const guard = and(
      actorStillInRank(input.orgId, actor),
      memberStillAsRead(input.orgId, input.userId, membership.role),
    )
    const written = existing
      ? first(
          await db
            .update(tenancyResourceRoleOverrides)
            .set({ role: input.role, updatedAt: timestamp })
            .where(and(eq(tenancyResourceRoleOverrides.id, existing.id), guard))
            .returning({ id: tenancyResourceRoleOverrides.id })
            .all(),
        )
      : first(
          await db
            .insert(tenancyResourceRoleOverrides)
            .select(
              db
                .select({
                  id: sqlText(override.id, 'id'),
                  orgId: sqlText(override.orgId, 'org_id'),
                  resourceKind: sqlText(override.resourceKind, 'resource_kind'),
                  resourceId: sqlText(override.resourceId, 'resource_id'),
                  userId: sqlText(override.userId, 'user_id'),
                  role: sqlText(override.role, 'role'),
                  createdAt: sqlNumber(timestamp, 'created_at'),
                  updatedAt: sqlNumber(timestamp, 'updated_at'),
                })
                .from(tenancyOrgs)
                .where(and(eq(tenancyOrgs.id, input.orgId), guard)),
            )
            .returning({ id: tenancyResourceRoleOverrides.id })
            .all(),
        )
    if (!written) throw rankWriteConflict(input.orgId)

    await audit({
      orgId: input.orgId,
      actorUserId: actor?.userId,
      action: 'override.set',
      subjectKind: 'resource_role_override',
      subjectId: override.id,
      details: {
        userId: input.userId,
        resourceKind: input.resource.kind,
        resourceId: input.resource.id,
        role: input.role,
      },
    })
    return override
  }

  async function findActiveSupportGrant(
    input: ResolveRoleInput,
  ): Promise<TenancySupportGrant | undefined> {
    const scopeMatch = input.resource
      ? or(
          isNull(tenancySupportGrants.resourceKind),
          and(
            eq(tenancySupportGrants.resourceKind, input.resource.kind),
            eq(tenancySupportGrants.resourceId, input.resource.id),
          ),
        )
      : isNull(tenancySupportGrants.resourceKind)

    return first(
      await db
        .select()
        .from(tenancySupportGrants)
        .where(
          and(
            eq(tenancySupportGrants.orgId, input.orgId),
            eq(tenancySupportGrants.granteeUserId, input.userId),
            isNull(tenancySupportGrants.revokedAt),
            gt(tenancySupportGrants.expiresAt, now()),
            scopeMatch,
          ),
        )
        .orderBy(desc(tenancySupportGrants.expiresAt))
        .limit(1)
        .all(),
    )
  }

  async function findInviteByToken(token: string): Promise<TenancyInvite | undefined> {
    const tokenHash = await sha256Hex(token)
    return first(
      await db
        .select()
        .from(tenancyInvites)
        .where(eq(tenancyInvites.tokenHash, tokenHash))
        .limit(1)
        .all(),
    )
  }

  async function acceptedInviteResult(
    invite: TenancyInvite,
    userId: string,
  ): Promise<AcceptInviteResult> {
    const membership = await requireMembership(invite.orgId, userId)
    const override =
      invite.resourceKind && invite.resourceId
        ? ((await findOverride(invite.orgId, userId, {
            kind: invite.resourceKind,
            id: invite.resourceId,
          })) ?? null)
        : null
    return { invite, membership, override, alreadyAccepted: true }
  }

  return {
    async createOrg(input) {
      const slug = requireText(input.slug, 'slug').toLowerCase()
      if (!ORG_SLUG_PATTERN.test(slug)) {
        throw new TenancyError('invalid', `Org slug ${slug} is not a valid slug.`)
      }
      const name = requireText(input.name, 'name')
      const createdByUserId = requireText(input.createdByUserId, 'createdByUserId')

      const clash = first(
        await db.select().from(tenancyOrgs).where(eq(tenancyOrgs.slug, slug)).limit(1).all(),
      )
      if (clash) throw new TenancyError('conflict', `Org slug ${slug} is already taken.`)

      const timestamp = now()
      const org: TenancyOrg = {
        id: nextId(),
        slug,
        name,
        createdByUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const orgCreateAuditId = nextId()
      const membership: TenancyMembership = {
        id: nextId(),
        orgId: org.id,
        userId: createdByUserId,
        role: 'owner',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      // Four auto-commits used to leave an ownerless org (and a burned slug)
      // when the membership write failed after the org insert. Invite
      // acceptance already batches for the same reason.
      try {
        await runTenancyBatch(db, [
          db.insert(tenancyOrgs).values(org).returning({ id: tenancyOrgs.id }),
          db
            .insert(tenancyAuditEvents)
            .values({
              id: orgCreateAuditId,
              orgId: org.id,
              actorUserId: createdByUserId,
              action: 'org.create',
              subjectKind: 'org',
              subjectId: org.id,
              detailsJson: JSON.stringify({ slug, name }),
              createdAt: timestamp,
            })
            .returning({ id: tenancyAuditEvents.id }),
          db.insert(tenancyMemberships).values(membership).returning({ id: tenancyMemberships.id }),
          db
            .insert(tenancyAuditEvents)
            .values({
              id: nextId(),
              orgId: org.id,
              actorUserId: createdByUserId,
              action: 'membership.add',
              subjectKind: 'membership',
              subjectId: membership.id,
              detailsJson: JSON.stringify({ userId: createdByUserId, role: 'owner' }),
              createdAt: timestamp,
            })
            .returning({ id: tenancyAuditEvents.id }),
        ])
      } catch (cause: unknown) {
        if (isTenancyUniqueConstraint(cause, 'org-slug')) {
          throw new TenancyError('conflict', `Org slug ${slug} is already taken.`)
        }
        if (isTenancyUniqueConstraint(cause, 'membership')) {
          throw new TenancyError(
            'conflict',
            `User ${createdByUserId} is already a member of org ${org.id}.`,
          )
        }
        throw cause
      }
      return org
    },

    async getOrg(orgId) {
      return (await findOrg(orgId)) ?? null
    },

    async listOrgsForUser(userId) {
      return db
        .select({
          id: tenancyOrgs.id,
          slug: tenancyOrgs.slug,
          name: tenancyOrgs.name,
          createdByUserId: tenancyOrgs.createdByUserId,
          createdAt: tenancyOrgs.createdAt,
          updatedAt: tenancyOrgs.updatedAt,
        })
        .from(tenancyMemberships)
        .innerJoin(tenancyOrgs, eq(tenancyOrgs.id, tenancyMemberships.orgId))
        .where(eq(tenancyMemberships.userId, userId))
        .orderBy(tenancyOrgs.slug)
        .all()
    },

    async addMember(input) {
      const actor = await resolveActor(input.orgId, input.actorUserId)
      requireRank(actor, input.role)
      await requireOrg(input.orgId)
      const existing = await findMembership(input.orgId, input.userId)
      if (existing) {
        throw new TenancyError(
          'conflict',
          `User ${input.userId} is already a member of org ${input.orgId}.`,
        )
      }
      return insertMembership(input, actor)
    },

    async setMemberRole(input) {
      const actor = await resolveActor(input.orgId, input.actorUserId)
      const membership = await requireMembership(input.orgId, input.userId)
      // The member as they stand and the role they would get, both in rank:
      // otherwise an admin could demote an owner, or make one. Checked before
      // the no-op, so an out-of-rank caller learns nothing from the answer.
      requireRank(actor, membership.role)
      requireRank(actor, input.role)
      if (membership.role === input.role) return membership
      return updateMembershipRole(membership, input.role, actor)
    },

    async removeMember(input) {
      const actor = await resolveActor(input.orgId, input.actorUserId)
      const membership = await requireMembership(input.orgId, input.userId)
      requireRank(actor, membership.role)

      // A membership is the only thing an override can narrow, so the two are
      // removed together rather than leaving orphan override rows behind.
      const orphaned = await db
        .select({ id: tenancyResourceRoleOverrides.id })
        .from(tenancyResourceRoleOverrides)
        .where(
          and(
            eq(tenancyResourceRoleOverrides.orgId, input.orgId),
            eq(tenancyResourceRoleOverrides.userId, input.userId),
          ),
        )
        .all()
      const removed = first(
        await db
          .delete(tenancyMemberships)
          .where(
            and(
              eq(tenancyMemberships.id, membership.id),
              stillInRank(membership, actor),
              preservesAnOwner(input.orgId, input.userId),
            ),
          )
          .returning()
          .all(),
      )
      if (!removed) throw await membershipWriteRefusal(membership, actor)
      await db
        .delete(tenancyResourceRoleOverrides)
        .where(
          and(
            eq(tenancyResourceRoleOverrides.orgId, input.orgId),
            eq(tenancyResourceRoleOverrides.userId, input.userId),
          ),
        )
        .run()
      await audit({
        orgId: input.orgId,
        actorUserId: actor?.userId,
        action: 'membership.remove',
        subjectKind: 'membership',
        subjectId: membership.id,
        details: {
          userId: input.userId,
          role: membership.role,
          clearedOverrides: orphaned.length,
        },
      })
    },

    async setResourceRoleOverride(input) {
      const actor = await resolveActor(input.orgId, input.actorUserId)
      const membership = await requireMembership(input.orgId, input.userId)
      // Narrowing cannot raise anybody, but it reduces whoever it names, and
      // an admin reducing an owner on a resource is the same trespass as
      // demoting them. The override itself is capped by the member's org role.
      requireRank(actor, membership.role)
      return upsertOverride(input, membership, actor)
    },

    async clearResourceRoleOverride(input) {
      const actor = await resolveActor(input.orgId, input.actorUserId)
      const override = await findOverride(input.orgId, input.userId, input.resource)
      if (!override) {
        throw new TenancyError(
          'not_found',
          `No override for ${input.resource.kind}:${input.resource.id} and user ${input.userId}.`,
        )
      }
      // Lifting a narrowing hands the member their org role back on the
      // resource, so it answers to the same rank as narrowing them did. An
      // override whose membership is gone grants nothing and ranks nothing —
      // but a membership *appearing* in the window would be handed a role this
      // check never ranked, so the DELETE asserts the member stands exactly as
      // it was read, present or absent (narduk-libs#537). A system call ranks
      // nobody, so it asserts nothing about the member and cannot conflict on
      // one moving.
      const membership = actor ? await findMembership(input.orgId, input.userId) : undefined
      if (actor && membership) requireRank(actor, membership.role)
      const cleared = first(
        await db
          .delete(tenancyResourceRoleOverrides)
          .where(
            and(
              eq(tenancyResourceRoleOverrides.id, override.id),
              actorStillInRank(input.orgId, actor),
              actor
                ? memberStillAsRead(input.orgId, input.userId, membership?.role ?? null)
                : undefined,
            ),
          )
          .returning({ id: tenancyResourceRoleOverrides.id })
          .all(),
      )
      if (!cleared) throw rankWriteConflict(input.orgId)
      await audit({
        orgId: input.orgId,
        actorUserId: actor?.userId,
        action: 'override.clear',
        subjectKind: 'resource_role_override',
        subjectId: override.id,
        details: {
          userId: input.userId,
          resourceKind: input.resource.kind,
          resourceId: input.resource.id,
          role: override.role,
        },
      })
    },

    async resolveRole(input) {
      const supportGrant = await findActiveSupportGrant(input)
      const membership = await findMembership(input.orgId, input.userId)
      if (!membership) {
        return supportGrant
          ? { role: null, source: 'none', supportGrant }
          : { role: null, source: 'none' }
      }

      const override = input.resource
        ? await findOverride(input.orgId, input.userId, input.resource)
        : undefined
      const resolution: TenancyRoleResolution = override
        ? { role: narrowerRole(membership.role, override.role), source: 'override' }
        : { role: membership.role, source: 'membership' }

      return supportGrant ? { ...resolution, supportGrant } : resolution
    },

    async createInvite(input) {
      const invitedByUserId = requireText(input.invitedByUserId, 'invitedByUserId')
      // Accepting grants the invite's role, so issuing it is granting it.
      const inviter = await requireActor(input.orgId, invitedByUserId)
      requireRank(inviter, input.role)
      await requireOrg(input.orgId)
      const email = requireText(input.email, 'email').toLowerCase()
      if (!isEmailAddress(email)) {
        throw new TenancyError('invalid', 'email is not a valid address.')
      }
      const issuedAt = now()
      const expiresAt = input.expiresAt ?? issuedAt + (input.ttlMs ?? INVITE_DEFAULT_TTL_MS)
      if (expiresAt <= issuedAt) {
        throw new TenancyError('invalid', 'Invite expiry must be in the future.')
      }

      const token = nextToken()
      const invite: TenancyInvite = {
        id: nextId(),
        orgId: input.orgId,
        email,
        role: input.role,
        resourceKind: input.resource?.kind ?? null,
        resourceId: input.resource?.id ?? null,
        tokenHash: await sha256Hex(token),
        invitedByUserId,
        expiresAt,
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
        createdAt: issuedAt,
      }
      // Issuing an invitation is granting its role, so the inviter's rank is
      // asserted inside the INSERT as well as before it (narduk-libs#537). An
      // inviter demoted or removed in that window issues nothing — the same
      // rule `acceptInvite` already applies to the claim.
      const issued = first(
        await db
          .insert(tenancyInvites)
          .select(
            db
              .select({
                id: sqlText(invite.id, 'id'),
                orgId: sqlText(invite.orgId, 'org_id'),
                email: sqlText(invite.email, 'email'),
                role: sqlText(invite.role, 'role'),
                resourceKind: sql<string | null>`${invite.resourceKind}`.as('resource_kind'),
                resourceId: sql<string | null>`${invite.resourceId}`.as('resource_id'),
                tokenHash: sqlText(invite.tokenHash, 'token_hash'),
                invitedByUserId: sqlText(invite.invitedByUserId, 'invited_by_user_id'),
                expiresAt: sqlNumber(expiresAt, 'expires_at'),
                acceptedAt: sql<number | null>`NULL`.as('accepted_at'),
                acceptedByUserId: sql<string | null>`NULL`.as('accepted_by_user_id'),
                revokedAt: sql<number | null>`NULL`.as('revoked_at'),
                createdAt: sqlNumber(issuedAt, 'created_at'),
              })
              .from(tenancyOrgs)
              .where(
                and(
                  eq(tenancyOrgs.id, input.orgId),
                  actorStillInRank(input.orgId, { role: inviter.role, userId: invitedByUserId }),
                ),
              ),
          )
          .returning({ id: tenancyInvites.id })
          .all(),
      )
      if (!issued) throw rankWriteConflict(input.orgId)
      await audit({
        orgId: input.orgId,
        actorUserId: invite.invitedByUserId,
        action: 'invite.create',
        subjectKind: 'invite',
        subjectId: invite.id,
        details: {
          email,
          role: invite.role,
          resourceKind: invite.resourceKind,
          resourceId: invite.resourceId,
          expiresAt,
        },
      })
      // The raw token is returned exactly once; only its digest is stored.
      return { invite, token }
    },

    async acceptInvite(input) {
      const userId = requireText(input.userId, 'userId')
      const invite = await findInviteByToken(requireText(input.token, 'token'))
      if (!invite) throw new TenancyError('not_found', 'Invite token does not match any invite.')
      if (
        input.verifiedEmail !== undefined &&
        requireText(input.verifiedEmail, 'verifiedEmail').toLowerCase() !== invite.email
      ) {
        throw new TenancyError('forbidden', 'The verified email does not match this invitation.')
      }

      if (invite.acceptedAt !== null) {
        // Idempotent for the accepting user; a second user may not reuse it.
        if (invite.acceptedByUserId === userId) return acceptedInviteResult(invite, userId)
        throw new TenancyError('conflict', `Invite ${invite.id} has already been accepted.`)
      }
      if (invite.revokedAt !== null) {
        throw new TenancyError('invalid', `Invite ${invite.id} has been revoked.`)
      }
      const acceptedAt = now()
      if (invite.expiresAt <= acceptedAt) {
        throw new TenancyError('expired', `Invite ${invite.id} expired.`)
      }

      // Accepting grants the invite's role, and the inviter is who granted it,
      // so the inviter must still stand at or above it. An invite does not
      // outlive its inviter's demotion or departure (narduk-libs#213). The
      // claim asserts the same again inside its write.
      const inviter = await findMembership(invite.orgId, invite.invitedByUserId)
      if (!inviter || !roleAtLeast(inviter.role, invite.role)) {
        throw new TenancyError(
          'forbidden',
          `Invite ${invite.id} was issued by a user who no longer holds ${invite.role} or above in org ${invite.orgId}.`,
        )
      }

      const claimed = await claimInviteMembership(db, invite, userId, acceptedAt, nextId)
      const accepted = await findInviteByToken(input.token)
      if (!accepted || accepted.acceptedByUserId !== userId) {
        throw new TenancyError('conflict', 'The invitation changed while it was being accepted.')
      }
      return { ...(await acceptedInviteResult(accepted, userId)), alreadyAccepted: !claimed }
    },

    async revokeInvite(input) {
      const actorUserId = actingUserId(input.actorUserId)
      const invite = first(
        await db
          .select()
          .from(tenancyInvites)
          .where(eq(tenancyInvites.id, input.inviteId))
          .limit(1)
          .all(),
      )
      if (!invite) throw new TenancyError('not_found', `Invite ${input.inviteId} does not exist.`)
      if (invite.acceptedAt !== null) {
        throw new TenancyError('conflict', `Invite ${invite.id} has already been accepted.`)
      }
      if (invite.revokedAt !== null) return invite

      const revokedAt = now()
      const revoked = first(
        await db
          .update(tenancyInvites)
          .set({ revokedAt })
          .where(
            and(
              eq(tenancyInvites.id, invite.id),
              isNull(tenancyInvites.acceptedAt),
              isNull(tenancyInvites.revokedAt),
            ),
          )
          .returning()
          .all(),
      )
      if (!revoked) {
        const current = first(
          await db.select().from(tenancyInvites).where(eq(tenancyInvites.id, invite.id)).all(),
        )
        if (current?.acceptedAt !== null || !current) {
          throw new TenancyError('conflict', `Invite ${invite.id} has already been accepted.`)
        }
        return current
      }
      await audit({
        orgId: invite.orgId,
        actorUserId,
        action: 'invite.revoke',
        subjectKind: 'invite',
        subjectId: invite.id,
        details: { email: invite.email },
      })
      return { ...invite, revokedAt }
    },

    async createSupportGrant(input) {
      await requireOrg(input.orgId)
      const reason = requireText(input.reason, 'reason')
      const { ttlSeconds } = input
      if (
        !Number.isInteger(ttlSeconds) ||
        ttlSeconds <= 0 ||
        ttlSeconds > SUPPORT_GRANT_MAX_TTL_SECONDS
      ) {
        throw new TenancyError(
          'invalid',
          `Support grant TTL must be a whole number of seconds in (0, ${SUPPORT_GRANT_MAX_TTL_SECONDS}].`,
        )
      }
      const scope = [...(input.scope ?? [])]
      if (scope.some((entry) => entry.trim().length === 0)) {
        throw new TenancyError('invalid', 'Support grant scope entries must not be empty.')
      }

      const createdAt = now()
      const grant: TenancySupportGrant = {
        id: nextId(),
        orgId: input.orgId,
        resourceKind: input.resource?.kind ?? null,
        resourceId: input.resource?.id ?? null,
        granteeUserId: requireText(input.granteeUserId, 'granteeUserId'),
        scopeJson: JSON.stringify(scope),
        reason,
        grantedByUserId: requireText(input.grantedByUserId, 'grantedByUserId'),
        expiresAt: createdAt + ttlSeconds * 1000,
        revokedAt: null,
        createdAt,
      }
      await db.insert(tenancySupportGrants).values(grant).run()
      await audit({
        orgId: input.orgId,
        actorUserId: grant.grantedByUserId,
        action: 'support_grant.create',
        subjectKind: 'support_grant',
        subjectId: grant.id,
        details: {
          granteeUserId: grant.granteeUserId,
          reason,
          scope,
          ttlSeconds,
          expiresAt: grant.expiresAt,
          resourceKind: grant.resourceKind,
          resourceId: grant.resourceId,
        },
      })
      return grant
    },

    async revokeSupportGrant(input) {
      const actorUserId = actingUserId(input.actorUserId)
      const grant = first(
        await db
          .select()
          .from(tenancySupportGrants)
          .where(eq(tenancySupportGrants.id, input.grantId))
          .limit(1)
          .all(),
      )
      if (!grant) {
        throw new TenancyError('not_found', `Support grant ${input.grantId} does not exist.`)
      }
      if (grant.revokedAt !== null) return grant

      const revokedAt = now()
      await db
        .update(tenancySupportGrants)
        .set({ revokedAt })
        .where(eq(tenancySupportGrants.id, grant.id))
        .run()
      await audit({
        orgId: grant.orgId,
        actorUserId,
        action: 'support_grant.revoke',
        subjectKind: 'support_grant',
        subjectId: grant.id,
        details: { granteeUserId: grant.granteeUserId },
      })
      return { ...grant, revokedAt }
    },

    async listActiveSupportGrants(input) {
      const limit = Math.min(Math.max(input.limit ?? 100, 1), SUPPORT_GRANT_LIST_MAX_LIMIT)
      const filters: Array<SQL | undefined> = [
        eq(tenancySupportGrants.orgId, input.orgId),
        isNull(tenancySupportGrants.revokedAt),
        gt(tenancySupportGrants.expiresAt, now()),
      ]
      if (input.userId) filters.push(eq(tenancySupportGrants.granteeUserId, input.userId))
      if (input.resource) {
        filters.push(
          or(
            isNull(tenancySupportGrants.resourceKind),
            and(
              eq(tenancySupportGrants.resourceKind, input.resource.kind),
              eq(tenancySupportGrants.resourceId, input.resource.id),
            ),
          ),
        )
      }

      return db
        .select()
        .from(tenancySupportGrants)
        .where(and(...filters))
        .orderBy(desc(tenancySupportGrants.expiresAt))
        .limit(limit)
        .all()
    },

    async listAuditEvents(input) {
      const limit = Math.min(
        Math.max(input.limit ?? AUDIT_EVENTS_DEFAULT_LIMIT, 1),
        AUDIT_EVENTS_MAX_LIMIT,
      )
      const filters: Array<SQL | undefined> = [eq(tenancyAuditEvents.orgId, input.orgId)]
      if (typeof input.before === 'number') {
        // The cursor matches the sort: (createdAt, id), both descending.
        filters.push(
          input.beforeId
            ? or(
                lt(tenancyAuditEvents.createdAt, input.before),
                and(
                  eq(tenancyAuditEvents.createdAt, input.before),
                  lt(tenancyAuditEvents.id, input.beforeId),
                ),
              )
            : lt(tenancyAuditEvents.createdAt, input.before),
        )
      }

      return db
        .select()
        .from(tenancyAuditEvents)
        .where(and(...filters))
        .orderBy(desc(tenancyAuditEvents.createdAt), desc(tenancyAuditEvents.id))
        .limit(limit)
        .all()
    },
  }
}
