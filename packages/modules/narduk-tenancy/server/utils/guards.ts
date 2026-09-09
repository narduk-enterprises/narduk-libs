import { createError } from 'h3'

import { roleAtLeast, type TenancyRole } from '../../shared/utils/roles'

import type { TenancyResourceRef, TenancySupportGrant } from '../../shared/types/tenancy'
import type { TenancyService } from './tenancy'
import type { H3Event } from 'h3'

export const TENANCY_UNAUTHENTICATED_ERROR_CODE = 'unauthenticated'
export const TENANCY_DENIED_ERROR_CODE = 'entitlement_denied'

/**
 * The tenancy surface a guard needs. Narrower than `TenancyService` on purpose:
 * a guard resolves entitlement and mutates nothing.
 */
export type TenancyRoleResolver = Pick<TenancyService, 'resolveRole'>

/** Resolves the caller's opaque user id, or null when the request is anonymous. */
export type TenancyUserResolver = (event: H3Event) => Promise<string | null> | string | null

export interface RequireOrgRoleOptions {
  minimum: TenancyRole
  orgId: string
  resolveUserId: TenancyUserResolver
  resource?: TenancyResourceRef
  tenancy: TenancyRoleResolver
}

export interface RequireSupportGrantOrRoleOptions extends RequireOrgRoleOptions {
  /**
   * Scope string the support grant must carry for the support path to pass.
   * The role path never consults it.
   */
  scope?: string
}

export interface TenancyGuardResult {
  role: TenancyRole | null
  supportGrant?: TenancySupportGrant
  userId: string
}

function unauthenticated(): Error {
  return createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    data: { errorCode: TENANCY_UNAUTHENTICATED_ERROR_CODE },
  })
}

function denied(): Error {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: { errorCode: TENANCY_DENIED_ERROR_CODE },
  })
}

async function requireUserId(event: H3Event, resolveUserId: TenancyUserResolver): Promise<string> {
  const userId = await resolveUserId(event)
  if (!userId) throw unauthenticated()
  return userId
}

function grantScopes(grant: TenancySupportGrant): string[] {
  try {
    const parsed: unknown = JSON.parse(grant.scopeJson)
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/**
 * Entitlement gate: the caller must be a member of `orgId` whose effective role
 * (org role, narrowed by a resource override when `resource` is given) is at
 * least `minimum`. Support grants are ignored here — support is not a role.
 */
export async function requireOrgRole(
  event: H3Event,
  options: RequireOrgRoleOptions,
): Promise<TenancyGuardResult> {
  const userId = await requireUserId(event, options.resolveUserId)
  const resolution = await options.tenancy.resolveRole({
    orgId: options.orgId,
    userId,
    resource: options.resource,
  })
  if (!resolution.role || !roleAtLeast(resolution.role, options.minimum)) throw denied()
  return { userId, role: resolution.role, supportGrant: resolution.supportGrant }
}

/**
 * As `requireOrgRole`, but an active, in-scope support grant also passes
 * (ADR-0010: time-boxed read-only diagnostic access). Use it only on read
 * paths; a mutation must keep using `requireOrgRole`.
 */
export async function requireSupportGrantOrRole(
  event: H3Event,
  options: RequireSupportGrantOrRoleOptions,
): Promise<TenancyGuardResult> {
  const userId = await requireUserId(event, options.resolveUserId)
  const resolution = await options.tenancy.resolveRole({
    orgId: options.orgId,
    userId,
    resource: options.resource,
  })

  if (resolution.role && roleAtLeast(resolution.role, options.minimum)) {
    return { userId, role: resolution.role, supportGrant: resolution.supportGrant }
  }

  const { supportGrant } = resolution
  const scopeSatisfied =
    supportGrant !== undefined &&
    (options.scope === undefined || grantScopes(supportGrant).includes(options.scope))
  if (!scopeSatisfied) throw denied()

  return { userId, role: resolution.role, supportGrant }
}
