import { hashTarget, recordDeliveries } from './audit.js'
import { NotifyError } from './errors.js'
import { createNotifyPreferences, requireCategory, resolvePreferences } from './preferences.js'

import type { ApnsClient, ApnsEnvironment, ApnsNotification, ApnsSendOptions } from './apns.js'
import type { DeliveryRecord } from './audit.js'
import type { NotifyD1Database } from './d1.js'
import type { EmailMessage, ResendClient } from './email.js'
import type {
  NotifyCategories,
  NotifyChannel,
  NotifyPreferences,
  ResolvedPreferences,
} from './preferences.js'

export interface PushTarget extends Omit<ApnsSendOptions, 'apnsId'> {
  /** A device token, or an activity push token for a Live Activity notification. */
  deviceToken: string
  environment?: ApnsEnvironment
}

export interface NotifyRequest {
  category: string
  email?: Omit<EmailMessage, 'from'> & { from?: string }
  push?: { notification: ApnsNotification; targets: readonly PushTarget[] }
  userId: string
}

export interface NotifyResult {
  /** Set when the audit batch failed; the sends above it still happened. */
  auditError: unknown
  deliveries: DeliveryRecord[]
  /**
   * Set when the preference read failed. The event was still sent on the
   * category's defaults and mandatory channels, so an alarm never waits on D1.
   */
  preferencesError: unknown
}

export interface NotifierOptions {
  apns?: ApnsClient
  categories: NotifyCategories
  db: NotifyD1Database
  email?: { client: ResendClient; from: string }
  newId?: () => string
  now?: () => number
}

export interface Notifier {
  readonly preferences: NotifyPreferences
  send: (request: NotifyRequest) => Promise<NotifyResult>
}

/**
 * One call per event: read the user's preferences once, send every allowed
 * target in parallel, then write every attempt (sent, failed, suppressed or
 * skipped) to the audit log in one batch.
 */
export function createNotifier(options: NotifierOptions): Notifier {
  const now = options.now ?? Date.now
  const newId = options.newId ?? (() => crypto.randomUUID())
  const preferences = createNotifyPreferences(options)

  return {
    preferences,
    send: async (request) => {
      requireCategory(options.categories, request.category)
      let preferencesError: unknown = null
      let all: ResolvedPreferences
      try {
        all = await preferences.get(request.userId)
      } catch (error) {
        preferencesError = error
        all = resolvePreferences(options.categories, [])
      }
      const resolved = all[request.category]
      const createdAt = now()
      const base = (channel: NotifyChannel, targetRef: string | null) => ({
        id: newId(),
        createdAt,
        userId: request.userId,
        category: request.category,
        channel,
        targetRef,
        pushType: null,
        environment: null,
        providerId: null,
        statusCode: null,
        reason: null,
        tokenInvalid: false,
      })
      const blockedBy = (channel: NotifyChannel, configured: boolean): DeliveryRecord | null => {
        if (!resolved?.[channel].enabled) {
          return { ...base(channel, null), status: 'suppressed', reason: 'preference_off' }
        }
        if (!configured) {
          return { ...base(channel, null), status: 'skipped', reason: 'channel_not_configured' }
        }
        return null
      }
      // A bad target (say, a malformed token) fails its own row, not the whole event.
      const attempt = async (
        record: () => Promise<DeliveryRecord>,
        fallback: () => Promise<DeliveryRecord>,
      ): Promise<DeliveryRecord> => {
        try {
          return await record()
        } catch (error) {
          return {
            ...(await fallback()),
            status: 'failed',
            reason: error instanceof NotifyError ? error.code : 'error',
          }
        }
      }

      const work: Array<Promise<DeliveryRecord>> = []
      const { apns } = options
      const push = request.push
      if (push && push.targets.length > 0) {
        const { notification } = push
        const blocked = blockedBy('push', apns !== undefined)
        if (blocked || !apns) {
          if (blocked) work.push(Promise.resolve({ ...blocked, pushType: notification.pushType }))
        } else {
          for (const target of push.targets) {
            const pushBase = async (): Promise<DeliveryRecord> => ({
              ...base('push', await hashTarget(String(target.deviceToken))),
              pushType: notification.pushType,
              environment: target.environment ?? apns.environment,
              status: 'failed',
            })
            work.push(
              attempt(async () => {
                const result = await apns.send(notification, target)
                return {
                  ...(await pushBase()),
                  status: result.ok ? 'sent' : 'failed',
                  providerId: result.apnsId,
                  statusCode: result.status,
                  reason: result.reason,
                  tokenInvalid: result.tokenInvalid,
                }
              }, pushBase),
            )
          }
        }
      }

      const { email } = options
      if (request.email) {
        const blocked = blockedBy('email', email !== undefined)
        if (blocked || !email) {
          if (blocked) work.push(Promise.resolve(blocked))
        } else {
          const message = { ...request.email, from: request.email.from ?? email.from }
          const recipients = Array.isArray(message.to) ? message.to : [message.to]
          work.push(
            attempt(
              async () => {
                const result = await email.client.send(message)
                return {
                  ...base('email', await hashTarget(recipients.join(','))),
                  status: result.ok ? 'sent' : 'failed',
                  providerId: result.id,
                  statusCode: result.status,
                  reason: result.reason,
                }
              },
              async () => ({ ...base('email', null), status: 'failed' }),
            ),
          )
        }
      }

      const deliveries = await Promise.all(work)
      let auditError: unknown = null
      try {
        await recordDeliveries(options.db, deliveries)
      } catch (error) {
        auditError = error
      }
      return { deliveries, auditError, preferencesError }
    },
  }
}
