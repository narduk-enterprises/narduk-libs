import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

import { nativeRefreshSchema } from '../../../lib/app-auth/native-validation'
import { useNativeAuth } from '../../../utils/native-auth'

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(nativeRefreshSchema.parse),
  },
  async ({ event, body }) => useNativeAuth(event).refresh(requireMutationBody(body)),
)
