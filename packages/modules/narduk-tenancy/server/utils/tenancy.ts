import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm'

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
import { narrowerRole, roleRank, type TenancyRole } from '../../shared/utils/roles'
import {
  tenancyAuditEvents,
  tenancyInvites,
  tenancyMemberships,
  tenancyOrgs,
  tenancyResourceRoleOverrides,
  tenancySupportGrants,
} from '../database/tenancy-schema'

import { TenancyError } from './tenancy-error'

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
  /** Millisecond epoch clock. Injectable so tests own time. */
  now?: () => number
  /** Primary-key generator. Defaults to `crypto.randomUUID()`. */
  idGenerator?: () => string
  /** Invite token generator. Defaults to 256 random bits, hex encoded. */
  tokenGenerator?: () => string
}

export const INVITE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SUPPORT_GRANT_MAX_TTL_SECONDS = 86_400
export const AUDIT_EVENTS_DEFAULT_LIMIT = 50
export const AUDIT_EVENTS_MAX_LIMIT = 200
export const SUPPORT_GRANT_LIST_MAX_LIMIT = 200

const ORG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function first<T>(rows: T[]): T | undefined {
  return rows.length > 0 ? rows[0] : undefined
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

export interface CreateOrgInput {
  slug: string
  name: string
  createdByUserId: string
}

export interface MemberInput {
  orgId: string
  userId: string
  actorUserId?: string | null
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
  userId: string
  resource?: TenancyResourceRef
}

export interface CreateInviteInput {
  orgId: string
  email: string
  role: TenancyRole
  resource?: TenancyResourceRef
  invitedByUserId: string
  /** Absolute millisecond epoch expiry. Takes precedence over `ttlMs`. */
  expiresAt?: number
  ttlMs?: number
}

export interface AcceptInviteInput {
  token: string
  userId: string
}

export interface AcceptInviteResult {
  invite: TenancyInvite
  membership: TenancyMembership
  override: TenancyResourceRoleOverride | null
  alreadyAccepted: boolean
}

export interface CreateSupportGrantInput {
  orgId: string
  granteeUserId: string
  grantedByUserId: string
  reason: string
  scope?: readonly string[]
  ttlSeconds: number
  resource?: TenancyResourceRef
}

export interface ListSupportGrantsInput {
  orgId: string
  userId?: string
  resource?: TenancyResourceRef
  limit?: number
}

export interface ListAuditEventsInput {
  orgId: string
  limit?: number
  /** Millisecond epoch; returns events strictly older than this. */
  before?: number
}

export interface TenancyService {
  createOrg: (input: CreateOrgInput) => Promise<TenancyOrg>
  getOrg: (orgId: string) => Promise<TenancyOrg | null>
  listOrgsForUser: (userId: string) => Promise<TenancyOrg[]>
  addMember: (input: AddMemberInput) => Promise<TenancyMembership>
  setMemberRole: (input: AddMemberInput) => Promise<TenancyMembership>
  removeMember: (input: MemberInput) => Promise<void>
  setResourceRoleOverride: (
    input: ResourceRoleOverrideInput,
  ) => Promise<TenancyResourceRoleOverride>
  clearResourceRoleOverride: (input: ClearResourceRoleOverrideInput) => Promise<void>
  resolveRole: (input: ResolveRoleInput) => Promise<TenancyRoleResolution>
  createInvite: (input: CreateInviteInput) => Promise<{ invite: TenancyInvite; token: string }>
  acceptInvite: (input: AcceptInviteInput) => Promise<AcceptInviteResult>
  revokeInvite: (input: { inviteId: string; actorUserId?: string | null }) => Promise<TenancyInvite>
  createSupportGrant: (input: CreateSupportGrantInput) => Promise<TenancySupportGrant>
  revokeSupportGrant: (input: {
    grantId: string
    actorUserId?: string | null
  }) => Promise<TenancySupportGrant>
  listActiveSupportGrants: (input: ListSupportGrantsInput) => Promise<TenancySupportGrant[]>
  listAuditEvents: (input: ListAuditEventsInput) => Promise<TenancyAuditEvent[]>
}

/**
 * Build the tenancy service over a caller-supplied database.
 *
 * Nothing here reads ambient request state, environment variables, or another
 * package's session: the consumer owns identity and passes user ids in.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- one factory holding the closure over db/clock; each returned operation is small.
export function createTenancy(
  db: TenancyDatabase,
  options: TenancyServiceOptions = {},
): TenancyService {
  const now = options.now ?? (() => Date.now())
  const nextId = options.idGenerator ?? (() => globalThis.crypto.randomUUID())
  const nextToken = options.tokenGenerator ?? defaultTokenGenerator

  async function audit(input: {
    orgId: string
    actorUserId?: string | null
    action: TenancyAuditAction
    subjectKind: string
    subjectId: string
    details?: Record<string, unknown>
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
    return first(await db.select().from(tenancyOrgs).where(eq(tenancyOrgs.id, orgId)).limit(1).all())
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

  /** True when `userId` is the only owner left in the org. */
  async function isLastOwner(orgId: string, userId: string): Promise<boolean> {
    const owners = await db
      .select({ userId: tenancyMemberships.userId })
      .from(tenancyMemberships)
      .where(and(eq(tenancyMemberships.orgId, orgId), eq(tenancyMemberships.role, 'owner')))
      // Two rows is all the evidence "more than one owner" needs.
      .limit(2)
      .all()
    return owners.length === 1 && owners[0]?.userId === userId
  }

  async function insertMembership(input: AddMemberInput): Promise<TenancyMembership> {
    const timestamp = now()
    const membership: TenancyMembership = {
      id: nextId(),
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(tenancyMemberships).values(membership).run()
    await audit({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
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
    actorUserId?: string | null,
  ): Promise<TenancyMembership> {
    const updated: TenancyMembership = { ...membership, role, updatedAt: now() }
    await db
      .update(tenancyMemberships)
      .set({ role, updatedAt: updated.updatedAt })
      .where(eq(tenancyMemberships.id, membership.id))
      .run()
    await audit({
      orgId: membership.orgId,
      actorUserId,
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

    if (existing) {
      await db
        .update(tenancyResourceRoleOverrides)
        .set({ role: input.role, updatedAt: timestamp })
        .where(eq(tenancyResourceRoleOverrides.id, existing.id))
        .run()
    } else {
      await db.insert(tenancyResourceRoleOverrides).values(override).run()
    }

    await audit({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
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

  async function ensureInviteMembership(
    invite: TenancyInvite,
    userId: string,
  ): Promise<TenancyMembership> {
    const existing = await findMembership(invite.orgId, userId)
    if (!existing) {
      return insertMembership({
        orgId: invite.orgId,
        userId,
        role: invite.role,
        actorUserId: userId,
      })
    }
    // An invite may promote, never silently demote: a user who is already an
    // admin does not lose that by accepting a `viewer` invite.
    if (roleRank(invite.role) > roleRank(existing.role)) {
      return updateMembershipRole(existing, invite.role, userId)
    }
    return existing
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
      await db.insert(tenancyOrgs).values(org).run()
      await audit({
        orgId: org.id,
        actorUserId: createdByUserId,
        action: 'org.create',
        subjectKind: 'org',
        subjectId: org.id,
        details: { slug, name },
      })
      await insertMembership({
        orgId: org.id,
        userId: createdByUserId,
        role: 'owner',
        actorUserId: createdByUserId,
      })
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
      await requireOrg(input.orgId)
      const existing = await findMembership(input.orgId, input.userId)
      if (existing) {
        throw new TenancyError(
          'conflict',
          `User ${input.userId} is already a member of org ${input.orgId}.`,
        )
      }
      return insertMembership(input)
    },

    async setMemberRole(input) {
      const membership = await requireMembership(input.orgId, input.userId)
      if (membership.role === input.role) return membership
      if (membership.role === 'owner' && (await isLastOwner(input.orgId, input.userId))) {
        throw new TenancyError('last_owner', `Org ${input.orgId} must keep at least one owner.`)
      }
      return updateMembershipRole(membership, input.role, input.actorUserId)
    },

    async removeMember(input) {
      const membership = await requireMembership(input.orgId, input.userId)
      if (membership.role === 'owner' && (await isLastOwner(input.orgId, input.userId))) {
        throw new TenancyError('last_owner', `Org ${input.orgId} must keep at least one owner.`)
      }

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
      await db
        .delete(tenancyResourceRoleOverrides)
        .where(
          and(
            eq(tenancyResourceRoleOverrides.orgId, input.orgId),
            eq(tenancyResourceRoleOverrides.userId, input.userId),
          ),
        )
        .run()
      await db.delete(tenancyMemberships).where(eq(tenancyMemberships.id, membership.id)).run()
      await audit({
        orgId: input.orgId,
        actorUserId: input.actorUserId,
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
      const membership = await requireMembership(input.orgId, input.userId)
      return upsertOverride(input, membership)
    },

    async clearResourceRoleOverride(input) {
      const override = await findOverride(input.orgId, input.userId, input.resource)
      if (!override) {
        throw new TenancyError(
          'not_found',
          `No override for ${input.resource.kind}:${input.resource.id} and user ${input.userId}.`,
        )
      }
      await db
        .delete(tenancyResourceRoleOverrides)
        .where(eq(tenancyResourceRoleOverrides.id, override.id))
        .run()
      await audit({
        orgId: input.orgId,
        actorUserId: input.actorUserId,
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
      await requireOrg(input.orgId)
      const email = requireText(input.email, 'email').toLowerCase()
      if (!EMAIL_PATTERN.test(email)) {
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
        invitedByUserId: requireText(input.invitedByUserId, 'invitedByUserId'),
        expiresAt,
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
        createdAt: issuedAt,
      }
      await db.insert(tenancyInvites).values(invite).run()
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

      await db
        .update(tenancyInvites)
        .set({ acceptedAt, acceptedByUserId: userId })
        .where(eq(tenancyInvites.id, invite.id))
        .run()
      const accepted: TenancyInvite = { ...invite, acceptedAt, acceptedByUserId: userId }

      const membership = await ensureInviteMembership(accepted, userId)
      const override =
        accepted.resourceKind && accepted.resourceId
          ? await upsertOverride(
              {
                orgId: accepted.orgId,
                userId,
                actorUserId: userId,
                resource: { kind: accepted.resourceKind, id: accepted.resourceId },
                role: accepted.role,
              },
              membership,
            )
          : null

      await audit({
        orgId: accepted.orgId,
        actorUserId: userId,
        action: 'invite.accept',
        subjectKind: 'invite',
        subjectId: accepted.id,
        details: { userId, role: accepted.role, email: accepted.email },
      })
      return { invite: accepted, membership, override, alreadyAccepted: false }
    },

    async revokeInvite(input) {
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
      await db
        .update(tenancyInvites)
        .set({ revokedAt })
        .where(eq(tenancyInvites.id, invite.id))
        .run()
      await audit({
        orgId: invite.orgId,
        actorUserId: input.actorUserId,
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
        actorUserId: input.actorUserId,
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
        filters.push(lt(tenancyAuditEvents.createdAt, input.before))
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
