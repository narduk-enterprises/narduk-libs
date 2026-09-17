import { defineEventHandler } from 'h3'

import { shouldRevalidateAuthSession } from '#narduk-auth-server/utils/auth-session-refresh-path'
import { useRefreshedSessionUser } from '#narduk-auth-server/utils/session-user'

export default defineEventHandler(async (event) => {
  if (!shouldRevalidateAuthSession(event.path)) {
    return
  }

  await useRefreshedSessionUser(event)
})
