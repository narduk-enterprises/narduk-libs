import { defineAdminQuery } from '@narduk-enterprises/narduk-core/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '@narduk-enterprises/narduk-core/server/utils/rateLimit'

import { getStoredChatModel, resolveStoredChatModel } from '../../../utils/chatModelConfig'
import { getXaiApiKey } from '../../../utils/xaiRuntimeConfig'

export default defineAdminQuery(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminAiModel,
  },
  async ({ event }) => {
    const apiKey = getXaiApiKey(event)

    return {
      currentModel: apiKey
        ? await resolveStoredChatModel(event, apiKey)
        : await getStoredChatModel(event),
    }
  },
)
