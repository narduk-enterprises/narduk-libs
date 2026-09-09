import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { logRecordSchema } from '../dist/schema.js'

writeFileSync(
  new URL('../schema/log-record.schema.json', import.meta.url),
  `${JSON.stringify(z.toJSONSchema(logRecordSchema), null, 2)}\n`,
)
