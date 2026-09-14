import { createAppDatabase } from '#layer/server/utils/database'
import * as d1Schema from '#narduk-auth-server/database/app-schema'

export const useAuthBridgeDatabase = createAppDatabase(d1Schema)
