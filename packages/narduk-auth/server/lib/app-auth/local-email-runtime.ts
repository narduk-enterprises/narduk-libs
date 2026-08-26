import {
  readRuntimeBoolean,
  readRuntimeString,
  readRuntimeStringFromKeys,
  readRuntimeStringList,
} from '@narduk-enterprises/narduk-core/server/utils/runtime-env'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { useLogger } from '#layer/server/utils/logger'

import { buildLocalEmailMessage, normalizeEmailAddress } from './local-email-core'
import { getAuthConfig, readRuntimeConfigString } from './supabase-client'

import type { LocalEmailLinkPurpose } from './local-email-core'
import type { H3Event } from 'h3'

const DEFAULT_TOKEN_TTL_MINUTES = 15
const MIN_TOKEN_TTL_MINUTES = 5
const MAX_TOKEN_TTL_MINUTES = 60

export interface LocalEmailSettings {
  allowlist: string[]
  appName: string
  appUrl: string
  from: string
  resendApiKey: string
  selfServeLinks: boolean
  tokenTtlMinutes: number
}

function boundedTtlMinutes(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_TOKEN_TTL_MINUTES
  return Math.min(Math.max(parsed, MIN_TOKEN_TTL_MINUTES), MAX_TOKEN_TTL_MINUTES)
}

export function readLocalEmailSettings(event: H3Event): LocalEmailSettings {
  const config = useRuntimeConfig(event)
  const authConfig = getAuthConfig(event)
  return {
    allowlist: readRuntimeStringList(event, 'AUTH_EMAIL_ALLOWLIST').map(normalizeEmailAddress),
    appName: readRuntimeConfigString(config.public.appName, 'Narduk app'),
    appUrl: readRuntimeString(event, 'AUTH_EMAIL_APP_URL', { fallback: authConfig.appUrl }),
    from: readRuntimeStringFromKeys(event, ['AUTH_EMAIL_FROM', 'MAIL_FROM']),
    resendApiKey: readRuntimeStringFromKeys(event, ['AUTH_EMAIL_RESEND_API_KEY', 'RESEND_API_KEY']),
    selfServeLinks: readRuntimeBoolean(event, 'AUTH_EMAIL_SELF_SERVE_LINKS'),
    tokenTtlMinutes: boundedTtlMinutes(readRuntimeString(event, 'AUTH_EMAIL_TOKEN_TTL_MINUTES')),
  }
}

export function assertLocalEmailDeliveryReady(settings: LocalEmailSettings): void {
  try {
    const appUrl = new URL(settings.appUrl)
    if (!['http:', 'https:'].includes(appUrl.protocol)) throw new Error('Unsupported protocol')
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Local email authentication is not configured for this app.',
    })
  }

  if (!settings.selfServeLinks && (!settings.resendApiKey || !settings.from)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Local email authentication is not configured for this app.',
    })
  }
}

export async function sendLocalEmailLink(
  event: H3Event,
  settings: LocalEmailSettings,
  params: {
    actionUrl: string
    email: string
    purpose: LocalEmailLinkPurpose
  },
): Promise<boolean> {
  const message = buildLocalEmailMessage({
    actionUrl: params.actionUrl,
    appName: settings.appName,
    purpose: params.purpose,
    ttlMinutes: settings.tokenTtlMinutes,
  })

  try {
    const response = await globalThis.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: settings.from,
        to: [params.email],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })

    if (response.ok) return true
    useLogger(event).child('AppAuth').error('Local auth email provider rejected request', {
      provider: 'resend',
      statusCode: response.status,
    })
  } catch {
    useLogger(event).child('AppAuth').error('Local auth email provider request failed', {
      provider: 'resend',
    })
  }

  return false
}
