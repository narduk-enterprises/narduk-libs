import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { installNitroLogging } from '../h3.js'
import { resolveLogLevel } from '../logger.js'
import type { RequestLoggingOptions } from '../h3.js'

export default defineNitroPlugin((nitro) => {
  installNitroLogging(nitro, (event) => {
    const config = useRuntimeConfig(event).nardukLogging as RequestLoggingOptions
    const cloudflare = event?.context.cloudflare as { env?: Record<string, unknown> } | undefined
    const override =
      cloudflare?.env?.LOG_LEVEL ??
      (typeof process === 'undefined' ? undefined : process.env.LOG_LEVEL)
    return {
      ...config,
      level: resolveLogLevel(override, config.level),
      runtime: cloudflare ? 'worker' : config.runtime,
    }
  })
})
