import { defineEventHandler } from 'h3'

import { useRefreshedSessionUserResponse } from '#narduk-auth-server/utils/session-user'

export default defineEventHandler(async (event) => useRefreshedSessionUserResponse(event))
