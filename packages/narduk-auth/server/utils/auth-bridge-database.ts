import { createAppDatabase } from '#layer/server/utils/database'
import * as d1Schema from '#narduk-auth-server/database/app-schema'
import * as pgSchema from '#narduk-auth-server/database/pg-app-schema'

export const useAuthBridgeDatabase = createAppDatabase({
  d1: d1Schema,
  pg: pgSchema,
})
