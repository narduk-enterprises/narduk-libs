import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

import { installServerExceptionCapture } from '../../shared/exception-capture'

import type { ServerExceptionCaptureHost } from '../../shared/exception-capture'

/**
 * Publishes every error Nitro announces on the shared `narduk:exception` hook.
 *
 * It writes no log record: narduk-logging's own `error` hook already completes
 * exactly one request summary per failing request (narduk-libs#359), and a
 * second record here would double every server error in the log.
 */
export default defineNitroPlugin((nitro) => {
  installServerExceptionCapture(nitro as unknown as ServerExceptionCaptureHost, {
    resolveBuildVersion: () => {
      try {
        const value = (useRuntimeConfig().public as Record<string, unknown>).buildVersion
        return typeof value === 'string' && value !== '' ? value : undefined
      } catch {
        // Runtime configuration is unavailable in isolated consumer fixtures.
        return undefined
      }
    },
  })
})
