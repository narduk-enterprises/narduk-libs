import { and, eq, gt, isNull } from 'drizzle-orm'
import { createError } from 'h3'

import { authNativeRefreshes, authNativeSessions } from '#narduk-auth/schema'

import type {
  NativeAuthClient,
  NativeAuthorizationRequest,
  NativeTokenResponse,
} from '../../../shared/types/native-auth'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

export type NativeDatabase = Pick<
  BaseSQLiteDatabase<'async', unknown>,
  'select' | 'insert' | 'update' | 'delete'
>
const ACCESS_SECONDS = 300
const SESSION_SECONDS = 30 * 24 * 60 * 60
const CODE_SECONDS = 60

/** How a directly issued native session proved its identity. */
export type NativeDirectGrant = 'apple' | 'passkey'

export function nativeAuthSecret(): string {
  return globalThis
    .btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export async function nativeAuthDigest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return globalThis
    .btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function invalidGrant(): never {
  throw createError({
    statusCode: 401,
    statusMessage: 'This sign-in credential is invalid or expired.',
  })
}

export function validateNativeAuthorization(
  clients: NativeAuthClient[],
  request: NativeAuthorizationRequest,
): NativeAuthClient {
  const client = clients.find((item) => item.id === request.clientId)
  if (
    !client ||
    !client.redirectUris.includes(request.redirectUri) ||
    request.codeChallengeMethod !== 'S256' ||
    !/^[\w-]{43}$/.test(request.codeChallenge) ||
    !/^[\w-]{32,128}$/.test(request.state)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid native sign-in request.' })
  }
  const redirect = new URL(request.redirectUri)
  if (
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    ['http:', 'javascript:', 'data:', 'file:'].includes(redirect.protocol)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid native callback address.' })
  }
  return client
}

/** HTTP adapters authorize the browser user. This service never trusts a caller-supplied identity. */
export function createNativeAuth(
  db: NativeDatabase,
  clients: NativeAuthClient[],
  clock = () => Math.floor(Date.now() / 1000),
) {
  const permitted = (clientId: string) => clients.some((client) => client.id === clientId)
  const live = () =>
    and(isNull(authNativeSessions.revokedAt), gt(authNativeSessions.expiresAt, clock()))

  async function issueCode(userId: string, request: NativeAuthorizationRequest): Promise<string> {
    validateNativeAuthorization(clients, request)
    const code = nativeAuthSecret()
    const now = clock()
    await db.insert(authNativeSessions).values({
      id: crypto.randomUUID(),
      userId,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      codeHash: await nativeAuthDigest(code),
      codeExpiresAt: now + CODE_SECONDS,
      expiresAt: now + SESSION_SECONDS,
      createdAt: now,
    })
    const redirect = new URL(request.redirectUri)
    redirect.searchParams.set('code', code)
    redirect.searchParams.set('state', request.state)
    return redirect.toString()
  }

  /**
   * A session for an identity the caller has just proven in this request (a
   * verified passkey assertion or Apple identity token), issued straight to
   * tokens with no code step. `redirect_uri` records the grant (`native:passkey`,
   * `native:apple`) and the code columns hold values no exchange can match.
   */
  async function issueSession(
    userId: string,
    clientId: string,
    grant: NativeDirectGrant,
  ): Promise<NativeTokenResponse> {
    if (!permitted(clientId)) return invalidGrant()
    const accessToken = nativeAuthSecret()
    const refreshToken = nativeAuthSecret()
    const now = clock()
    const id = crypto.randomUUID()
    const expiresAt = now + SESSION_SECONDS
    await db.insert(authNativeSessions).values({
      id,
      userId,
      clientId,
      redirectUri: `native:${grant}`,
      codeChallenge: '',
      codeHash: null,
      codeExpiresAt: now,
      accessHash: await nativeAuthDigest(accessToken),
      accessExpiresAt: now + ACCESS_SECONDS,
      refreshHash: await nativeAuthDigest(refreshToken),
      expiresAt,
      createdAt: now,
    })
    return {
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      expiresIn: ACCESS_SECONDS,
      refreshExpiresAt: expiresAt,
      sessionId: id,
    }
  }

  async function rotate(where: Parameters<typeof and>[number]): Promise<NativeTokenResponse> {
    const accessToken = nativeAuthSecret()
    const refreshToken = nativeAuthSecret()
    const [row] = await db
      .update(authNativeSessions)
      .set({
        codeHash: null,
        accessHash: await nativeAuthDigest(accessToken),
        accessExpiresAt: clock() + ACCESS_SECONDS,
        refreshHash: await nativeAuthDigest(refreshToken),
      })
      .where(and(where, live()))
      .returning()
    if (!row) return invalidGrant()
    return {
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      expiresIn: ACCESS_SECONDS,
      refreshExpiresAt: row.expiresAt,
      sessionId: row.id,
    }
  }

  async function exchange(input: {
    clientId: string
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<NativeTokenResponse> {
    if (
      !clients.some(
        (client) => client.id === input.clientId && client.redirectUris.includes(input.redirectUri),
      ) ||
      !/^[\w.~-]{43,128}$/.test(input.codeVerifier)
    )
      return invalidGrant()
    return rotate(
      and(
        eq(authNativeSessions.clientId, input.clientId),
        eq(authNativeSessions.redirectUri, input.redirectUri),
        eq(authNativeSessions.codeHash, await nativeAuthDigest(input.code)),
        eq(authNativeSessions.codeChallenge, await nativeAuthDigest(input.codeVerifier)),
        gt(authNativeSessions.codeExpiresAt, clock()),
      ),
    )
  }

  /**
   * Rotates a refresh token. A token this session already rotated away is a
   * loose copy: whichever holder presents it, the session ends for both
   * (narduk-libs#2179). The spent token's primary key in `auth_native_refreshes`
   * is the single-use guard, so two concurrent presentations of one token end
   * the session too, instead of minting two live successors.
   */
  async function refresh(input: {
    clientId: string
    refreshToken: string
  }): Promise<NativeTokenResponse> {
    if (!permitted(input.clientId)) return invalidGrant()
    const refreshHash = await nativeAuthDigest(input.refreshToken)
    const [session] = await db
      .select({ id: authNativeSessions.id })
      .from(authNativeSessions)
      .where(
        and(
          eq(authNativeSessions.clientId, input.clientId),
          eq(authNativeSessions.refreshHash, refreshHash),
          live(),
        ),
      )
      .limit(1)
    if (!session) {
      const [spent] = await db
        .select({ sessionId: authNativeRefreshes.sessionId })
        .from(authNativeRefreshes)
        .where(eq(authNativeRefreshes.refreshHash, refreshHash))
        .limit(1)
      if (spent) await revokeSession(spent.sessionId)
      return invalidGrant()
    }
    const [claimed] = await db
      .insert(authNativeRefreshes)
      .values({ refreshHash, sessionId: session.id, rotatedAt: clock() })
      .onConflictDoNothing()
      .returning({ sessionId: authNativeRefreshes.sessionId })
    if (!claimed) {
      await revokeSession(session.id)
      return invalidGrant()
    }
    return rotate(
      and(eq(authNativeSessions.id, session.id), eq(authNativeSessions.refreshHash, refreshHash)),
    )
  }

  async function resolve(accessToken: string) {
    const [row] = await db
      .select()
      .from(authNativeSessions)
      .where(
        and(
          live(),
          eq(authNativeSessions.accessHash, await nativeAuthDigest(accessToken)),
          gt(authNativeSessions.accessExpiresAt, clock()),
        ),
      )
      .limit(1)
    if (!row || !permitted(row.clientId)) return null
    return {
      sessionId: row.id,
      userId: row.userId,
      clientId: row.clientId,
      expiresAt: row.expiresAt,
    }
  }

  async function revoke(refreshToken: string): Promise<void> {
    await db
      .update(authNativeSessions)
      .set({ revokedAt: clock(), accessHash: null, refreshHash: null, codeHash: null })
      .where(eq(authNativeSessions.refreshHash, await nativeAuthDigest(refreshToken)))
  }

  async function revokeSession(sessionId: string): Promise<void> {
    await db
      .update(authNativeSessions)
      .set({ revokedAt: clock(), accessHash: null, refreshHash: null, codeHash: null })
      .where(eq(authNativeSessions.id, sessionId))
  }

  async function revokeUser(userId: string): Promise<void> {
    await db
      .update(authNativeSessions)
      .set({ revokedAt: clock(), accessHash: null, refreshHash: null, codeHash: null })
      .where(eq(authNativeSessions.userId, userId))
  }

  /**
   * Ends every session a user signed in to directly with `grant`. A session
   * does not record which passkey (or Apple ID) minted it, so this is the
   * narrowest revocation removing one credential can make.
   */
  async function revokeUserGrant(userId: string, grant: NativeDirectGrant): Promise<void> {
    await db
      .update(authNativeSessions)
      .set({ revokedAt: clock(), accessHash: null, refreshHash: null, codeHash: null })
      .where(
        and(
          eq(authNativeSessions.userId, userId),
          eq(authNativeSessions.redirectUri, `native:${grant}`),
        ),
      )
  }

  return {
    issueCode,
    issueSession,
    exchange,
    refresh,
    resolve,
    revoke,
    revokeUser,
    revokeUserGrant,
  }
}
