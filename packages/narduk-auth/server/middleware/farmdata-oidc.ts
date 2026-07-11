import { eq } from 'drizzle-orm'
import { createError, getRequestURL, readBody } from 'h3'
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

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (pathname === '/.well-known/openid-configuration') {
    return farmDataOIDCConfiguration(event)
  }
  if (pathname === '/.well-known/jwks.json') {
    return farmDataOIDCJWKS(event)
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
