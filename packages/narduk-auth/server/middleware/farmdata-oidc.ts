import { eq } from 'drizzle-orm'
import { createError, getQuery, getRequestURL, readBody, sendRedirect } from 'h3'
import { z } from 'zod'

import { farmDataUserFarms } from '#narduk-auth-server/database/app-schema'
import { getCurrentSessionUser } from '#narduk-auth-server/utils/app-auth'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import {
  farmDataOIDCConfiguration,
  farmDataOIDCJWKS,
  issueFarmDataAccessToken,
} from '#narduk-auth-server/utils/farmdata-oidc'

const bodySchema = z.object({
  grant_type: z.literal('urn:narduk:params:oauth:grant-type:session'),
  farm_id: z.string().trim().min(1).max(128),
})

const authorizeSchema = z.object({
  client_id: z.literal('myfarm-macos'),
  response_type: z.literal('token'),
  redirect_uri: z.literal('myfarm://farmdata-auth'),
  state: z.string().trim().min(16).max(256),
  farm_id: z.string().trim().min(1).max(128),
  scope: z.string().trim().max(512).optional(),
  code_challenge: z.string().trim().min(43).max(128).optional(),
  code_challenge_method: z.literal('S256').optional(),
})

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (pathname === '/.well-known/openid-configuration') {
    return farmDataOIDCConfiguration(event)
  }
  if (pathname === '/.well-known/jwks.json') {
    return farmDataOIDCJWKS(event)
  }
  if (pathname === '/oauth/authorize') {
    if (event.method !== 'GET') {
      throw createError({ statusCode: 405, statusMessage: 'Use GET for the FarmData authorization endpoint.' })
    }
    const parsed = authorizeSchema.safeParse(getQuery(event))
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid FarmData authorization request.' })
    }
    const sessionUser = await getCurrentSessionUser(event)
    if (!sessionUser) {
      throw createError({ statusCode: 401, statusMessage: 'A signed-in FarmData user session is required.' })
    }
    const db = useAuthBridgeDatabase(event)
    const rows = await db
      .select({ farmId: farmDataUserFarms.farmId })
      .from(farmDataUserFarms)
      .where(eq(farmDataUserFarms.userId, sessionUser.id))
      .limit(256)
    const farmIDs = rows.map((row) => row.farmId)
    if (!farmIDs.includes(parsed.data.farm_id)) {
      throw createError({ statusCode: 403, statusMessage: 'The signed-in user is not authorized for this farm.' })
    }
    const token = await issueFarmDataAccessToken(event, {
      email: sessionUser.email,
      farmIDs,
      subject: sessionUser.id,
    })
    const callback = new URL(parsed.data.redirect_uri)
    callback.searchParams.set('access_token', token.accessToken)
    callback.searchParams.set('audience', token.audience)
    callback.searchParams.set('farm_ids', farmIDs.join(','))
    callback.searchParams.set('state', parsed.data.state)
    return sendRedirect(event, callback.toString(), 302)
  }
  if (pathname !== '/oauth/token') return
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Use POST for the FarmData token endpoint.' })
  }

  const sessionUser = await getCurrentSessionUser(event)
  if (!sessionUser) {
    throw createError({ statusCode: 401, statusMessage: 'A signed-in FarmData user session is required.' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid FarmData token request.' })
  }

  const db = useAuthBridgeDatabase(event)
  const rows = await db
    .select({ farmId: farmDataUserFarms.farmId })
    .from(farmDataUserFarms)
    .where(eq(farmDataUserFarms.userId, sessionUser.id))
    .limit(256)
  const farmIDs = rows.map((row) => row.farmId)
  if (!farmIDs.includes(parsed.data.farm_id)) {
    throw createError({ statusCode: 403, statusMessage: 'The signed-in user is not authorized for this farm.' })
  }

  const token = await issueFarmDataAccessToken(event, {
    email: sessionUser.email,
    farmIDs,
    subject: sessionUser.id,
  })
  return {
    token_type: 'Bearer',
    access_token: token.accessToken,
    expires_in: token.expiresIn,
    audience: token.audience,
    issuer: token.issuer,
  }
})
