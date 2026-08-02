import { createError, defineEventHandler, readBody } from 'h3'

import { requireAdmin, requireAuth, requireAuthScopes } from '#layer/server/utils/auth'
import { requireCronAuth } from '#layer/server/utils/cron'
import { enforceRateLimitPolicy } from '#layer/server/utils/rateLimit'

import { describeValidationFailure } from './mutationValidation'

import type { AuthUser } from '#layer/server/utils/auth'
import type { RateLimitPolicy } from '#layer/server/utils/rateLimit'
import type { EventHandler, H3Event } from 'h3'

function throwValidationError(error: unknown): never {
  const d = describeValidationFailure(error)
  if (d.kind === 'http') {
    throw d.error
  }
  throw createError({ statusCode: d.statusCode, statusMessage: d.statusMessage })
}

type MaybePromise<T> = T | Promise<T>
type MutationBodyValidator<TBody> = (body: unknown) => MaybePromise<TBody>
type MutationAuthResolver<TContext> = (event: H3Event) => MaybePromise<TContext>

const resolveEmptyAuth: MutationAuthResolver<Record<string, never>> = () => ({})
export type MutationBodyParser<TBody> = (event: H3Event) => MaybePromise<TBody>
export type MutationRateLimit =
  RateLimitPolicy | ((event: H3Event) => MaybePromise<RateLimitPolicy>)

export interface MutationOptionsWithoutBody {
  parseBody?: undefined
  rateLimit: MutationRateLimit
  requiredScopes?: readonly string[]
}

export interface MutationOptionsWithBody<TBody> {
  parseBody: MutationBodyParser<TBody>
  rateLimit: MutationRateLimit
  requiredScopes?: readonly string[]
}

export type MutationOptions<TBody = undefined> =
  MutationOptionsWithoutBody | MutationOptionsWithBody<TBody>

interface MutationContext<TBody> {
  body: TBody
  event: H3Event
}
type MutationAnyOptions = MutationOptionsWithoutBody | MutationOptionsWithBody<unknown>

async function buildMutationContextWithoutBody<TContext>(
  event: H3Event,
  options: MutationOptionsWithoutBody,
  resolveAuth: MutationAuthResolver<TContext>,
): Promise<MutationContext<undefined> & TContext> {
  const ratePolicy = await resolveMutationRateLimit(event, options.rateLimit)
  await enforceRateLimitPolicy(event, ratePolicy)
  const authContext = await resolveAuth(event)

  return {
    event,
    body: undefined,
    ...authContext,
  }
}

async function buildMutationContextWithBody<TBody, TContext>(
  event: H3Event,
  options: MutationOptionsWithBody<TBody>,
  resolveAuth: MutationAuthResolver<TContext>,
): Promise<MutationContext<TBody> & TContext> {
  const ratePolicy = await resolveMutationRateLimit(event, options.rateLimit)
  await enforceRateLimitPolicy(event, ratePolicy)
  const authContext = await resolveAuth(event)
  const body = await options.parseBody(event)

  return {
    event,
    body,
    ...authContext,
  }
}

async function resolveMutationRateLimit(
  event: H3Event,
  rateLimit: MutationRateLimit,
): Promise<RateLimitPolicy> {
  return typeof rateLimit === 'function' ? await rateLimit(event) : rateLimit
}

export async function readValidatedMutationBody<TBody>(
  event: H3Event,
  validate: MutationBodyValidator<TBody>,
): Promise<TBody> {
  try {
    return await validate(await readBody<unknown>(event))
  } catch (error) {
    throwValidationError(error)
  }
}

export async function readOptionalMutationBody(
  event: H3Event,
  fallback: unknown = {},
): Promise<unknown> {
  try {
    return await readBody<unknown>(event)
  } catch {
    return fallback
  }
}

export async function readOptionalValidatedMutationBody<TBody>(
  event: H3Event,
  validate: MutationBodyValidator<TBody>,
  fallback: unknown = {},
): Promise<TBody> {
  try {
    return await validate(await readOptionalMutationBody(event, fallback))
  } catch (error) {
    throwValidationError(error)
  }
}

export function requireMutationBody<TBody>(
  body: TBody | undefined,
  message = 'Mutation body missing after validation',
): TBody {
  if (body === undefined) {
    throw createError({
      statusCode: 500,
      statusMessage: message,
    })
  }

  return body
}

export function withValidatedBody<TBody>(
  validate: MutationBodyValidator<TBody>,
): MutationBodyParser<TBody> {
  return (event) => readValidatedMutationBody(event, validate)
}

export function withOptionalValidatedBody<TBody>(
  validate: MutationBodyValidator<TBody>,
  fallback: unknown = {},
): MutationBodyParser<TBody> {
  return (event) => readOptionalValidatedMutationBody(event, validate, fallback)
}

export function definePublicMutation<TBody, TResult = unknown>(
  options: MutationOptionsWithBody<TBody>,
  handler: (context: MutationContext<TBody>) => MaybePromise<TResult>,
): EventHandler
export function definePublicMutation<TResult = unknown>(
  options: MutationOptionsWithoutBody,
  handler: (context: MutationContext<undefined>) => MaybePromise<TResult>,
): EventHandler
export function definePublicMutation(
  options: MutationAnyOptions,
  handler:
    | ((context: MutationContext<unknown>) => MaybePromise<unknown>)
    | ((context: MutationContext<undefined>) => MaybePromise<unknown>),
): EventHandler {
  return defineEventHandler(async (event) => {
    if (options.parseBody) {
      const context = await buildMutationContextWithBody(
        event,
        options as MutationOptionsWithBody<unknown>,
        resolveEmptyAuth,
      )
      return (handler as (ctx: MutationContext<unknown>) => MaybePromise<unknown>)(context)
    }

    const context = await buildMutationContextWithoutBody(event, options, resolveEmptyAuth)
    return (handler as (ctx: MutationContext<undefined>) => MaybePromise<unknown>)(context)
  })
}

export function defineUserMutation<TBody, TResult = unknown>(
  options: MutationOptionsWithBody<TBody>,
  handler: (context: MutationContext<TBody> & { user: AuthUser }) => MaybePromise<TResult>,
): EventHandler
export function defineUserMutation<TResult = unknown>(
  options: MutationOptionsWithoutBody,
  handler: (context: MutationContext<undefined> & { user: AuthUser }) => MaybePromise<TResult>,
): EventHandler
export function defineUserMutation(
  options: MutationAnyOptions,
  handler:
    | ((context: MutationContext<unknown> & { user: AuthUser }) => MaybePromise<unknown>)
    | ((context: MutationContext<undefined> & { user: AuthUser }) => MaybePromise<unknown>),
): EventHandler {
  return defineEventHandler(async (event) => {
    if (options.parseBody) {
      const context = await buildMutationContextWithBody(
        event,
        options as MutationOptionsWithBody<unknown>,
        async () => ({
          user: await resolveUserWithScopes(event, options.requiredScopes),
        }),
      )
      return (
        handler as (ctx: MutationContext<unknown> & { user: AuthUser }) => MaybePromise<unknown>
      )(context)
    }

    const context = await buildMutationContextWithoutBody(event, options, async () => ({
      user: await resolveUserWithScopes(event, options.requiredScopes),
    }))
    return (
      handler as (ctx: MutationContext<undefined> & { user: AuthUser }) => MaybePromise<unknown>
    )(context)
  })
}

export function defineAdminMutation<TBody, TResult = unknown>(
  options: MutationOptionsWithBody<TBody>,
  handler: (context: MutationContext<TBody> & { admin: AuthUser }) => MaybePromise<TResult>,
): EventHandler
export function defineAdminMutation<TResult = unknown>(
  options: MutationOptionsWithoutBody,
  handler: (context: MutationContext<undefined> & { admin: AuthUser }) => MaybePromise<TResult>,
): EventHandler
export function defineAdminMutation(
  options: MutationAnyOptions,
  handler:
    | ((context: MutationContext<unknown> & { admin: AuthUser }) => MaybePromise<unknown>)
    | ((context: MutationContext<undefined> & { admin: AuthUser }) => MaybePromise<unknown>),
): EventHandler {
  return defineEventHandler(async (event) => {
    if (options.parseBody) {
      const context = await buildMutationContextWithBody(
        event,
        options as MutationOptionsWithBody<unknown>,
        async () => ({
          admin: await resolveAdminWithScopes(event, options.requiredScopes),
        }),
      )
      return (
        handler as (ctx: MutationContext<unknown> & { admin: AuthUser }) => MaybePromise<unknown>
      )(context)
    }

    const context = await buildMutationContextWithoutBody(event, options, async () => ({
      admin: await resolveAdminWithScopes(event, options.requiredScopes),
    }))
    return (
      handler as (ctx: MutationContext<undefined> & { admin: AuthUser }) => MaybePromise<unknown>
    )(context)
  })
}

type AdminQueryHandlerNoQuery<TResult> = (ctx: {
  admin: AuthUser
  event: H3Event
}) => MaybePromise<TResult>

type AdminQueryHandlerWithQuery<TQuery, TResult> = (ctx: {
  admin: AuthUser
  event: H3Event
  query: TQuery
}) => MaybePromise<TResult>

/**
 * Admin GET handler: rate limit, then requireAdmin, then handler.
 * Optional `parseQuery` should call `getValidatedQuery` (or equivalent) so validation matches other routes.
 */
export function defineAdminQuery<TResult>(
  options: {
    parseQuery?: undefined
    rateLimit: MutationRateLimit
    requiredScopes?: readonly string[]
  },
  handler: AdminQueryHandlerNoQuery<TResult>,
): EventHandler

export function defineAdminQuery<TQuery, TResult>(
  options: {
    parseQuery: (event: H3Event) => MaybePromise<TQuery>
    rateLimit: MutationRateLimit
    requiredScopes?: readonly string[]
  },
  handler: AdminQueryHandlerWithQuery<TQuery, TResult>,
): EventHandler

export function defineAdminQuery<TQuery, TResult>(
  options: {
    parseQuery?: (event: H3Event) => MaybePromise<TQuery>
    rateLimit: MutationRateLimit
    requiredScopes?: readonly string[]
  },
  handler: AdminQueryHandlerNoQuery<TResult> | AdminQueryHandlerWithQuery<TQuery, TResult>,
): EventHandler {
  return defineEventHandler(async (event) => {
    const ratePolicy = await resolveMutationRateLimit(event, options.rateLimit)
    await enforceRateLimitPolicy(event, ratePolicy)
    const admin = await resolveAdminWithScopes(event, options.requiredScopes)
    if (options.parseQuery) {
      const query = await options.parseQuery(event)
      return (handler as AdminQueryHandlerWithQuery<TQuery, TResult>)({ event, admin, query })
    }
    return (handler as AdminQueryHandlerNoQuery<TResult>)({ event, admin })
  })
}

type UserQueryHandlerNoQuery<TResult> = (ctx: {
  event: H3Event
  user: AuthUser
}) => MaybePromise<TResult>

type UserQueryHandlerWithQuery<TQuery, TResult> = (ctx: {
  event: H3Event
  query: TQuery
  user: AuthUser
}) => MaybePromise<TResult>

/**
 * Authenticated GET handler: rate limit, then requireAuth, then handler.
 */
export function defineUserQuery<TResult>(
  options: {
    parseQuery?: undefined
    rateLimit: MutationRateLimit
    requiredScopes?: readonly string[]
  },
  handler: UserQueryHandlerNoQuery<TResult>,
): EventHandler

export function defineUserQuery<TQuery, TResult>(
  options: {
    parseQuery: (event: H3Event) => MaybePromise<TQuery>
    rateLimit: MutationRateLimit
    requiredScopes?: readonly string[]
  },
  handler: UserQueryHandlerWithQuery<TQuery, TResult>,
): EventHandler

export function defineUserQuery<TQuery, TResult>(
  options: {
    parseQuery?: (event: H3Event) => MaybePromise<TQuery>
    rateLimit: MutationRateLimit
    requiredScopes?: readonly string[]
  },
  handler: UserQueryHandlerNoQuery<TResult> | UserQueryHandlerWithQuery<TQuery, TResult>,
): EventHandler {
  return defineEventHandler(async (event) => {
    const ratePolicy = await resolveMutationRateLimit(event, options.rateLimit)
    await enforceRateLimitPolicy(event, ratePolicy)
    const user = await resolveUserWithScopes(event, options.requiredScopes)
    if (options.parseQuery) {
      const query = await options.parseQuery(event)
      return (handler as UserQueryHandlerWithQuery<TQuery, TResult>)({ event, user, query })
    }
    return (handler as UserQueryHandlerNoQuery<TResult>)({ event, user })
  })
}

async function resolveUserWithScopes(
  event: H3Event,
  requiredScopes?: readonly string[],
): Promise<AuthUser> {
  const user = await requireAuth(event)
  requireAuthScopes(user, requiredScopes)
  return user
}

async function resolveAdminWithScopes(
  event: H3Event,
  requiredScopes?: readonly string[],
): Promise<AuthUser> {
  const admin = await requireAdmin(event)
  requireAuthScopes(admin, requiredScopes)
  return admin
}

export function defineCronMutation<TBody, TResult = unknown>(
  options: MutationOptionsWithBody<TBody>,
  handler: (context: MutationContext<TBody>) => MaybePromise<TResult>,
): EventHandler
export function defineCronMutation<TResult = unknown>(
  options: MutationOptionsWithoutBody,
  handler: (context: MutationContext<undefined>) => MaybePromise<TResult>,
): EventHandler
export function defineCronMutation(
  options: MutationAnyOptions,
  handler:
    | ((context: MutationContext<unknown>) => MaybePromise<unknown>)
    | ((context: MutationContext<undefined>) => MaybePromise<unknown>),
): EventHandler {
  return defineEventHandler(async (event) => {
    const resolveCronAuth: MutationAuthResolver<Record<string, never>> = (cronEvent) => {
      requireCronAuth(cronEvent)
      return {}
    }

    if (options.parseBody) {
      const context = await buildMutationContextWithBody(
        event,
        options as MutationOptionsWithBody<unknown>,
        resolveCronAuth,
      )
      return (handler as (ctx: MutationContext<unknown>) => MaybePromise<unknown>)(context)
    }

    const context = await buildMutationContextWithoutBody(event, options, resolveCronAuth)
    return (handler as (ctx: MutationContext<undefined>) => MaybePromise<unknown>)(context)
  })
}

/** @alias Compatibility alias for webhook-style public mutations. */
export const defineWebhookMutation = definePublicMutation
/** @alias Compatibility alias for callback-style public mutations. */
export const defineCallbackMutation = definePublicMutation
