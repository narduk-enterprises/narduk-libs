import { createError } from 'h3'

import { roleAtLeast, type TenancyRole } from '../../shared/utils/roles'

import { supportGrantScopes } from './tenancy'

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
  /**
   * A sentence for the 403, carried as `data.message` (and the error's
   * `message`) beside `errorCode: 'entitlement_denied'`. Without it the 403 has
   * no sentence, as before.
   */
  deniedMessage?: string
  minimum: TenancyRole
  orgId: string
  resolveUserId: TenancyUserResolver
  resource?: TenancyResourceRef
  tenancy: TenancyRoleResolver
  /** As `deniedMessage`, for the 401 an anonymous caller gets. */
  unauthenticatedMessage?: string
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

function guardError(
  statusCode: 401 | 403,
  statusMessage: string,
  errorCode: string,
  message: string | undefined,
): Error {
  return createError({
    statusCode,
    statusMessage,
    ...(message === undefined
      ? { data: { errorCode } }
      : { message, data: { errorCode, message } }),
  })
}

function unauthenticated(message?: string): Error {
  return guardError(401, 'Unauthorized', TENANCY_UNAUTHENTICATED_ERROR_CODE, message)
}

function denied(message?: string): Error {
  return guardError(403, 'Forbidden', TENANCY_DENIED_ERROR_CODE, message)
}

async function requireUserId(event: H3Event, options: RequireOrgRoleOptions): Promise<string> {
  const userId = await options.resolveUserId(event)
  if (!userId) throw unauthenticated(options.unauthenticatedMessage)
  return userId
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
  const userId = await requireUserId(event, options)
  const resolution = await options.tenancy.resolveRole({
    orgId: options.orgId,
    userId,
    resource: options.resource,
  })
  if (!resolution.role || !roleAtLeast(resolution.role, options.minimum)) {
    throw denied(options.deniedMessage)
  }
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
  const userId = await requireUserId(event, options)
  // Asking for the scope means the resolver returns a grant that covers it,
  // not merely the latest-expiring one (narduk-libs#942).
  const resolution = await options.tenancy.resolveRole({
    orgId: options.orgId,
    userId,
    resource: options.resource,
    supportScope: options.scope,
  })

  if (resolution.role && roleAtLeast(resolution.role, options.minimum)) {
    return { userId, role: resolution.role, supportGrant: resolution.supportGrant }
  }

  const { supportGrant } = resolution
  const scopeSatisfied =
    supportGrant !== undefined &&
    (options.scope === undefined || supportGrantScopes(supportGrant).includes(options.scope))
  if (!scopeSatisfied) throw denied(options.deniedMessage)

  return { userId, role: resolution.role, supportGrant }
}
