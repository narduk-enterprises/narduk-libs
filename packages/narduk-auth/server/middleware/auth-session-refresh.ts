import { defineEventHandler } from 'h3'

import { useRefreshedSessionUser } from '#narduk-auth-server/utils/session-user'

export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/admin/') && path !== '/api/auth/me') {
    return
  }

  await useRefreshedSessionUser(event)
})
