import { useNitroApp } from 'nitropack/runtime'

import { useLogger } from '#layer/server/utils/logger'

import type { LocalEmailLinkPurpose } from '../lib/app-auth/local-email-core'
import type { LocalEmailSettings } from '../lib/app-auth/local-email-runtime'
import type { H3Event } from 'h3'

export interface AuthEmailMessage {
  html: string
  subject: string
  text: string
}

/**
 * What the `narduk-auth:email` hook receives before a password link is sent.
 *
 * `message` holds the library's plain default. A handler that brands the
 * email replaces `message`; it must keep `actionUrl` in both parts and should
 * keep the expiry, because the link stops working after `ttlMinutes`.
 */
export interface AuthEmailRenderContext {
  actionUrl: string
  appName: string
  appUrl: string
  email: string
  message: AuthEmailMessage
  purpose: LocalEmailLinkPurpose
  ttlMinutes: number
}

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    'narduk-auth:email': (context: AuthEmailRenderContext, event: H3Event) => void | Promise<void>
  }
}

/**
 * Lets the app replace the password-link email.
 *
 * Register a handler in a Nitro plugin:
 * `nitroApp.hooks.hook('narduk-auth:email', (context) => { context.message = … })`.
 * A handler that throws or leaves the action link out is ignored, so a broken
 * template degrades to the default email rather than to no email.
 */
export async function renderAuthEmail(
  event: H3Event,
  context: AuthEmailRenderContext,
): Promise<AuthEmailMessage> {
  const fallback = context.message
  try {
    await useNitroApp().hooks.callHook('narduk-auth:email', context, event)
  } catch {
    useLogger(event).child('AppAuth').error('Auth email template hook failed; sending the default')
    return fallback
  }
  const message = context.message
  if (
    !message ||
    typeof message.subject !== 'string' ||
    message.subject.trim() === '' ||
    !message.text?.includes(context.actionUrl) ||
    !message.html?.includes(escapeAttribute(context.actionUrl))
  ) {
    useLogger(event)
      .child('AppAuth')
      .error('Auth email template dropped the action link; sending the default')
    return fallback
  }
  return message
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Sends one transactional email through the app's configured auth sender.
 *
 * Apps use this for their own account email (a farm invitation, say) so every
 * message leaves from the same verified address. Returns whether the provider
 * accepted it; it never throws for a delivery failure, and it never logs the
 * recipient.
 */
export async function sendAuthEmail(
  event: H3Event,
  settings: Pick<LocalEmailSettings, 'from' | 'resendApiKey'>,
  params: { message: AuthEmailMessage; to: string },
): Promise<boolean> {
  if (!settings.resendApiKey || !settings.from) {
    useLogger(event).child('AppAuth').error('Auth email sender is not configured')
    return false
  }
  try {
    const response = await globalThis.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: settings.from,
        to: [params.to],
        subject: params.message.subject,
        text: params.message.text,
        html: params.message.html,
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
