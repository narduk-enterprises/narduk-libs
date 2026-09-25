import { createError, getHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeString } from './runtime-env'

import type { H3Event } from 'h3'

const encoder = new TextEncoder()

/**
 * Compare two strings in time that depends only on the longer one's length,
 * so a rejected guess does not reveal how many leading bytes matched. `!==`
 * exits at the first differing character (narduk-libs#871).
 */
function timingSafeEqualText(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return difference === 0
}

export function requireCronAuth(event: H3Event) {
  const runtimeConfig = useRuntimeConfig(event)
  const cronSecret = readRuntimeString(event, 'CRON_SECRET', {
    config: runtimeConfig,
    fallback: runtimeConfig.cronSecret,
  })

  if (!cronSecret) {
    if (import.meta.dev) {
      return
    }

    throw createError({
      statusCode: 500,
      message: 'CRON_SECRET is not configured.',
    })
  }

  const authorization = getHeader(event, 'authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!timingSafeEqualText(token, cronSecret)) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized cron request.',
    })
  }
}
