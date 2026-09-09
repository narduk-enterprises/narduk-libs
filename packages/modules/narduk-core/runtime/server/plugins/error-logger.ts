import { installNitroLogging } from '@narduk-enterprises/narduk-logging/h3'
import { defineNitroPlugin } from 'nitropack/runtime'

import { resolveLoggingOptions } from '../utils/logger'

/** One registration also covers request completion, errors, silent mode, and sanitization. */
export default defineNitroPlugin((nitro) => {
  installNitroLogging(nitro, resolveLoggingOptions)
})
