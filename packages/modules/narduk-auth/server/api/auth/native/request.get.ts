import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3'

import { validateNativeAuthorization } from '../../../lib/app-auth/native-core'
import { nativeAuthorizationSchema } from '../../../lib/app-auth/native-validation'
import { nativeAuthClients } from '../../../utils/native-auth'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const request = nativeAuthorizationSchema.safeParse(getQuery(event))
  if (!request.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid native sign-in request.' })
  const client = validateNativeAuthorization(nativeAuthClients(event), request.data)
  return { clientName: client.name }
})
