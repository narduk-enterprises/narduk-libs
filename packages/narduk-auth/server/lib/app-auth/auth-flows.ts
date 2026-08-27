import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { hashUserPassword, verifyUserPassword } from '#layer/server/utils/password'
import { authUserLinks } from '#narduk-auth-server/app-orm-tables'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import { stampAuthSessionValidated } from '#narduk-auth-server/utils/auth-session-stability'
import { type User as LocalUser, users } from '#narduk-core/schema'

import {
  buildAppPath,
  buildAppUrl,
  isAuthProvider,
  normalizeEmail,
  sanitizeNextPath,
  toSessionUser,
} from './helpers'
import { ensureLinkedLocalUser } from './linking'
import { requestLocalEmailPasswordLink } from './local-email-flow'
import {
  assertLocalEmailAttemptAllowed,
  clearLocalEmailAttempts,
  recordLocalEmailAttemptFailure,
} from './local-email-throttle'
import {
  clearCurrentSession,
  getCurrentSessionUser,
  getCurrentSupabaseContext,
  persistSupabaseSession,
  setCurrentSessionUser,
} from './session'
import {
  createSupabaseClient,
  createSupabaseUserClient,
  getAuthConfig,
  isSupabaseConfigured,
  toSupabaseHttpError,
} from './supabase-client'

import type {
  AuthMutationResult,
  ExchangeCodeOptions,
  LoginInput,
  NativeAppleSignInInput,
  OAuthStartInput,
  PasswordResetRequest,
  RegisterInput,
} from './types'
import type { H3Event } from 'h3'

function isPasswordRecoveryRedirectType(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replaceAll('-', '_')
  return normalized === 'recovery' || normalized === 'password_recovery'
}

function isInviteRedirectType(value: string | null | undefined) {
  return value?.trim().toLowerCase() === 'invite'
}

export async function loginUser(event: H3Event, body: LoginInput): Promise<AuthMutationResult> {
  const config = getAuthConfig(event)
  if (config.backend === 'supabase' && isSupabaseConfigured(config)) {
    return loginWithSupabase(event, body)
  }
  return loginWithLocalAuth(event, body)
}

async function loginWithLocalAuth(event: H3Event, body: LoginInput): Promise<AuthMutationResult> {
  const db = useDatabase(event)
  const normalizedEmail = normalizeEmail(body.email)
  await assertLocalEmailAttemptAllowed(event, 'login', normalizedEmail)
  const user = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, normalizedEmail)),
  )

  // A syntactically valid dummy hash keeps unknown-account work comparable to
  // a real password check without recording personal email addresses in logs.
  const passwordHash = user?.passwordHash ?? `${'0'.repeat(32)}:${'0'.repeat(64)}`
  const isValid = await verifyUserPassword(body.password, passwordHash)
  if (!user?.passwordHash || !isValid) {
    await recordLocalEmailAttemptFailure(event, 'login', normalizedEmail)
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid email or password',
    })
  }

  const sessionUser = toSessionUser(user, {
    authBackend: 'local',
    authProvider: user.appleId ? 'apple' : 'email',
    authProviders: user.appleId ? ['apple', 'email'] : ['email'],
    needsPasswordSetup: false,
  })
  await setCurrentSessionUser(event, sessionUser)
  await clearLocalEmailAttempts(event, 'login', normalizedEmail)

  return {
    user: sessionUser,
    nextStep: 'signed_in',
  }
}

async function loginWithSupabase(event: H3Event, body: LoginInput): Promise<AuthMutationResult> {
  const config = getAuthConfig(event)
  const client = createSupabaseUserClient(event)
  const { data, error } = await client.signInWithPassword({
    email: normalizeEmail(body.email),
    password: body.password,
    options: body.captchaToken ? { captchaToken: body.captchaToken } : undefined,
  })

  if (error) {
    toSupabaseHttpError(error, 401)
  }

  const localUser = await ensureLinkedLocalUser(event, data.user, {
    requireExistingLink: !config.publicSignup,
  })
  const persisted = await persistSupabaseSession(event, {
    authUser: data.user,
    localUser,
    session: data.session,
  })
  const sessionUser = stampAuthSessionValidated(
    toSessionUser(localUser, {
      authBackend: 'supabase',
      authSessionId: persisted.authSessionId,
      authProvider: persisted.authProvider,
      authProviders: persisted.providers,
      emailConfirmedAt: persisted.emailConfirmedAt,
      aal: persisted.aal,
      needsPasswordSetup: persisted.needsPasswordSetup,
      recoveryMode: persisted.recoveryMode,
    }),
  )
  await setCurrentSessionUser(event, sessionUser)

  return {
    user: sessionUser,
    nextStep: 'signed_in',
  }
}

export async function registerUser(
  event: H3Event,
  body: RegisterInput,
): Promise<AuthMutationResult> {
  const config = getAuthConfig(event)
  if (!config.publicSignup) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Public signup is disabled for this app.',
    })
  }

  if (config.backend === 'supabase' && isSupabaseConfigured(config)) {
    return registerWithSupabase(event, body)
  }
  return registerWithLocalAuth(event, body)
}

async function registerWithLocalAuth(
  event: H3Event,
  body: RegisterInput,
): Promise<AuthMutationResult> {
  const log = useLogger(event).child('AppAuth')
  const db = useDatabase(event)
  const normalizedEmail = normalizeEmail(body.email)
  const existingUser = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, normalizedEmail)),
  )

  if (existingUser) {
    log.warn('Local registration rejected for an existing address')
    throw createError({
      statusCode: 409,
      statusMessage: 'Email already in use',
    })
  }

  const userId = crypto.randomUUID()
  const passwordHash = await hashUserPassword(body.password)
  await db.insert(users).values({
    id: userId,
    email: normalizedEmail,
    name: body.name.trim(),
    passwordHash,
  })

  const user = await getDatabaseRow<LocalUser>(db.select().from(users).where(eq(users.id, userId)))
  if (!user) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create the local account.',
    })
  }

  const sessionUser = toSessionUser(user, {
    authBackend: 'local',
    authProvider: 'email',
    authProviders: ['email'],
    needsPasswordSetup: false,
  })
  await setCurrentSessionUser(event, sessionUser)

  return {
    user: sessionUser,
    nextStep: 'signed_in',
  }
}

async function registerWithSupabase(
  event: H3Event,
  body: RegisterInput,
): Promise<AuthMutationResult> {
  const config = getAuthConfig(event)
  const client = createSupabaseUserClient(event)
  const next = sanitizeNextPath(body.next, config.redirectPath)
  const confirmUrl = buildAppUrl(config.appUrl, config.confirmPath, {
    next,
  })
  const { data, error } = await client.signUp({
    email: normalizeEmail(body.email),
    password: body.password,
    options: {
      data: {
        name: body.name.trim(),
        full_name: body.name.trim(),
      },
      emailRedirectTo: confirmUrl,
      ...(body.captchaToken ? { captchaToken: body.captchaToken } : {}),
    },
  })

  if (error) {
    toSupabaseHttpError(error)
  }

  if (data.session && data.user) {
    const localUser = await ensureLinkedLocalUser(event, data.user)
    const persisted = await persistSupabaseSession(event, {
      authUser: data.user,
      localUser,
      session: data.session,
    })
    const sessionUser = stampAuthSessionValidated(
      toSessionUser(localUser, {
        authBackend: 'supabase',
        authSessionId: persisted.authSessionId,
        authProvider: persisted.authProvider,
        authProviders: persisted.providers,
        emailConfirmedAt: persisted.emailConfirmedAt,
        aal: persisted.aal,
        needsPasswordSetup: persisted.needsPasswordSetup,
        recoveryMode: persisted.recoveryMode,
      }),
    )
    await setCurrentSessionUser(event, sessionUser)

    return {
      user: sessionUser,
      nextStep: 'signed_in',
      redirectTo: next,
    }
  }

  return {
    user: null,
    nextStep: 'email_confirmation',
    message: 'Check your email to confirm the account before signing in.',
  }
}

export async function startOAuthFlow(event: H3Event, body: OAuthStartInput) {
  const config = getAuthConfig(event)
  if (config.backend !== 'supabase' || !isSupabaseConfigured(config)) {
    throw createError({
      statusCode: 501,
      statusMessage: 'OAuth sign-in is not enabled for local auth mode.',
    })
  }

  if (!config.providers.includes(body.provider)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Provider "${body.provider}" is not enabled for this app.`,
    })
  }

  const client = createSupabaseUserClient(event)
  const next = sanitizeNextPath(body.next, config.redirectPath)
  const redirectTo = buildAppUrl(config.appUrl, config.callbackPath, { next })
  const { data, error } = await client.signInWithOAuth({
    provider: body.provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'login' },
    },
  })

  if (error || !data.url) {
    if (error) toSupabaseHttpError(error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to start the OAuth flow.',
    })
  }

  return {
    url: data.url,
  }
}

export async function signInWithNativeApple(
  event: H3Event,
  body: NativeAppleSignInInput,
): Promise<AuthMutationResult> {
  const config = getAuthConfig(event)
  if (config.backend !== 'supabase' || !isSupabaseConfigured(config)) {
    throw createError({
      statusCode: 501,
      statusMessage: 'Native Apple sign-in is only available when Supabase auth is enabled.',
    })
  }

  if (!config.providers.includes('apple')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Apple sign-in is not enabled for this app.',
    })
  }

  const token = body.identityToken.trim()
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Apple identity token is required.',
    })
  }

  const client = createSupabaseUserClient(event)
  const { data, error } = await client.signInWithIdToken({
    provider: 'apple',
    token,
    ...(body.nonce ? { nonce: body.nonce } : {}),
  })

  if (error || !data.user || !data.session) {
    if (error) toSupabaseHttpError(error, 401)
    throw createError({
      statusCode: 401,
      statusMessage: 'Apple sign-in could not be exchanged for a session.',
    })
  }

  const localUser = await ensureLinkedLocalUser(event, data.user)
  const persisted = await persistSupabaseSession(event, {
    authUser: data.user,
    localUser,
    session: data.session,
  })
  const sessionUser = stampAuthSessionValidated(
    toSessionUser(localUser, {
      authBackend: 'supabase',
      authSessionId: persisted.authSessionId,
      authProvider: persisted.authProvider,
      authProviders: persisted.providers,
      emailConfirmedAt: persisted.emailConfirmedAt,
      aal: persisted.aal,
      needsPasswordSetup: persisted.needsPasswordSetup,
      recoveryMode: persisted.recoveryMode,
    }),
  )
  await setCurrentSessionUser(event, sessionUser)

  return {
    user: sessionUser,
    nextStep: 'signed_in',
    redirectTo: config.redirectPath,
  }
}

export async function exchangeSupabaseCode(
  event: H3Event,
  body: ExchangeCodeOptions,
): Promise<AuthMutationResult> {
  const config = getAuthConfig(event)
  if (config.backend !== 'supabase' || !isSupabaseConfigured(config)) {
    throw createError({
      statusCode: 501,
      statusMessage: 'Code exchange is only available when Supabase auth is enabled.',
    })
  }

  const client = createSupabaseUserClient(event)
  const hasAuthCode = typeof body.code === 'string'
  const { data, error } = hasAuthCode
    ? await client.exchangeCodeForSession(body.code)
    : await client.verifyOtp({
        token_hash: body.tokenHash,
        type: body.verificationType,
      })

  if (error || !data.user || !data.session) {
    if (error) toSupabaseHttpError(error, 401)
    throw createError({
      statusCode: 401,
      statusMessage: 'The auth callback could not be exchanged for a session.',
    })
  }

  const redirectType =
    typeof (data as { redirectType?: string | null }).redirectType === 'string'
      ? (data as { redirectType?: string | null }).redirectType
      : !hasAuthCode
        ? body.verificationType
        : null
  const isPasswordRecovery = isPasswordRecoveryRedirectType(redirectType)
  const permitsClosedSignupLink = isInviteRedirectType(redirectType) || isPasswordRecovery
  const localUser = await ensureLinkedLocalUser(event, data.user, {
    requireExistingLink: !config.publicSignup && !permitsClosedSignupLink,
  })
  const next = sanitizeNextPath(body.next, config.redirectPath)
  // Same-origin path, not an absolute URL: the client panel feeds this to
  // navigateTo, which rejects absolute URLs without `external: true`.
  const redirectTo = isPasswordRecovery
    ? buildAppPath(config.resetPath, { recovery: '1', next })
    : next
  const persisted = await persistSupabaseSession(event, {
    authUser: data.user,
    localUser,
    session: data.session,
    recoveryMode: isPasswordRecovery,
  })
  const sessionUser = stampAuthSessionValidated(
    toSessionUser(localUser, {
      authBackend: 'supabase',
      authSessionId: persisted.authSessionId,
      authProvider: persisted.authProvider,
      authProviders: persisted.providers,
      emailConfirmedAt: persisted.emailConfirmedAt,
      aal: persisted.aal,
      needsPasswordSetup: persisted.needsPasswordSetup,
      recoveryMode: persisted.recoveryMode,
    }),
  )
  await setCurrentSessionUser(event, sessionUser)

  return {
    user: sessionUser,
    nextStep: 'signed_in',
    redirectTo,
  }
}

export async function requestPasswordReset(
  event: H3Event,
  body: PasswordResetRequest,
): Promise<AuthMutationResult> {
  const config = getAuthConfig(event)
  if (config.backend === 'local') {
    return requestLocalEmailPasswordLink(event, body)
  }

  if (!isSupabaseConfigured(config)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Password reset is not configured for this app.',
    })
  }

  const client = createSupabaseUserClient(event)
  const redirectTo = buildAppUrl(config.appUrl, config.callbackPath, {
    next: config.resetPath,
  })
  const { error } = await client.resetPasswordForEmail(normalizeEmail(body.email), {
    redirectTo,
    ...(body.captchaToken ? { captchaToken: body.captchaToken } : {}),
  })

  if (error) {
    toSupabaseHttpError(error)
  }

  return {
    user: null,
    nextStep: 'password_recovery_sent',
    message: 'Check your email for the password reset link.',
  }
}

export async function logoutUser(event: H3Event) {
  const config = getAuthConfig(event)
  const sessionUser = await getCurrentSessionUser(event)

  if (config.backend === 'supabase' && sessionUser?.authSessionId) {
    try {
      const context = await getCurrentSupabaseContext(event)
      await context.client.signOut()
    } catch {
      // Clearing the app-local session is the important part; auth service logout
      // failure should not trap the user in a broken state.
    }
  }

  await clearCurrentSession(event)
  return { success: true }
}

/**
 * Deletes the Supabase Auth identity that is linked to the given local user.
 *
 * Looks up the upstream `auth_user_id` from the `auth_user_links` bridge
 * table, then calls the Supabase Admin API with the service-role key to
 * permanently remove the identity. If no link exists (e.g. the account was
 * created before Supabase was enabled), the function is a no-op.
 *
 * Call this inside a `beforeDelete` hook passed to `deleteCurrentUserAccount`
 * so that the upstream identity is removed before the local DB row is deleted.
 */
export async function deleteSupabaseAuthUser(event: H3Event, localUserId: string): Promise<void> {
  const config = getAuthConfig(event)
  const appDb = useAuthBridgeDatabase(event)

  const link = await getDatabaseRow<typeof authUserLinks.$inferSelect>(
    appDb.select().from(authUserLinks).where(eq(authUserLinks.localUserId, localUserId)),
  )

  if (!link) {
    return
  }

  const client = createSupabaseClient(event, config.serviceRoleKey)
  const { error } = await client.admin.deleteUser(link.authUserId)
  if (error) {
    if (error.status === 404) {
      useLogger(event).child('AppAuth').info('Supabase auth user already deleted', {
        authUserId: link.authUserId,
        localUserId,
      })
      return
    }
    toSupabaseHttpError(error, 500)
  }
}

export function getAuthUiState(event?: H3Event) {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()

  return {
    backend: config.public.authBackend,
    authorityUrl: config.public.authAuthorityUrl,
    providers: config.public.authProviders.filter(isAuthProvider),
    publicSignup: config.public.authPublicSignup,
    requireMfa: config.public.authRequireMfa,
    loginPath: config.public.authLoginPath,
    registerPath: config.public.authRegisterPath,
    callbackPath: config.public.authCallbackPath,
    confirmPath: config.public.authConfirmPath,
    resetPath: config.public.authResetPath,
    logoutPath: config.public.authLogoutPath,
    redirectPath: config.public.authRedirectPath,
    turnstileSiteKey: config.public.authTurnstileSiteKey,
  }
}
