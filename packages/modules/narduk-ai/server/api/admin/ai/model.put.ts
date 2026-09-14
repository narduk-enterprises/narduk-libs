import {
  defineAdminMutation,
  withValidatedBody,
} from '@narduk-enterprises/narduk-core/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '@narduk-enterprises/narduk-core/server/utils/rateLimit'
import { z } from 'zod'

import { setStoredChatModel } from '../../../utils/chatModelConfig'

const schema = z.object({
  model: z.string().min(1),
})

export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminAiModel,
    parseBody: withValidatedBody(schema.parse),
  },
  async ({ event, body }) => {
    await setStoredChatModel(event, body.model)

    return { success: true, model: body.model }
  },
)
