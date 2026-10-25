import type { ApnsEnvironment, ApnsPushType } from './apns.js'
import type { NotifyD1Database } from './d1.js'
import type { NotifyChannel } from './preferences.js'

export type DeliveryStatus = 'failed' | 'sent' | 'skipped' | 'suppressed'

export interface DeliveryRecord {
  category: string
  channel: NotifyChannel
  createdAt: number
  environment: ApnsEnvironment | null
  id: string
  /** `apns-id` or the Resend email id. */
  providerId: string | null
  pushType: ApnsPushType | null
  /** Provider reason, or `preference_off` / `channel_not_configured`. */
  reason: string | null
  status: DeliveryStatus
  statusCode: number | null
  /** SHA-256 hex of the token or lowercased address. */
  targetRef: string | null
  tokenInvalid: boolean
  userId: string
}

interface DeliveryRow {
  category: string
  channel: NotifyChannel
  created_at: number
  environment: ApnsEnvironment | null
  id: string
  provider_id: string | null
  push_type: ApnsPushType | null
  reason: string | null
  status: DeliveryStatus
  status_code: number | null
  target_ref: string | null
  token_invalid: number
  user_id: string
}

/**
 * Hash a delivery target so the audit log never holds a token or an address.
 * Lowercased first: device tokens are hex and addresses are case-insensitive.
 */
export async function hashTarget(target: string): Promise<string> {
  const normalized = target.trim().toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toRecord(row: DeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    userId: row.user_id,
    category: row.category,
    channel: row.channel,
    pushType: row.push_type,
    environment: row.environment,
    targetRef: row.target_ref,
    status: row.status,
    providerId: row.provider_id,
    statusCode: row.status_code,
    reason: row.reason,
    tokenInvalid: row.token_invalid === 1,
  }
}

const INSERT_DELIVERY = `INSERT INTO notify_deliveries
  (id, created_at, user_id, category, channel, push_type, environment, target_ref,
   status, provider_id, status_code, reason, token_invalid)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`

/** Write every record in one D1 batch: one round trip whatever the fan-out. */
export async function recordDeliveries(
  db: NotifyD1Database,
  records: readonly DeliveryRecord[],
): Promise<void> {
  if (records.length === 0) return
  const statement = db.prepare(INSERT_DELIVERY)
  await db.batch(
    records.map((record) =>
      statement.bind(
        record.id,
        record.createdAt,
        record.userId,
        record.category,
        record.channel,
        record.pushType,
        record.environment,
        record.targetRef,
        record.status,
        record.providerId,
        record.statusCode,
        record.reason,
        record.tokenInvalid ? 1 : 0,
      ),
    ),
  )
}

export interface ListDeliveriesOptions {
  /**
   * Page back from a row: pass the last row of the previous page. Rows of one
   * event share `createdAt`, so the cursor is `(createdAt, id)`, never time alone.
   */
  before?: Pick<DeliveryRecord, 'createdAt' | 'id'>
  limit?: number
  userId: string
}

/** A user's deliveries, newest first, served by `notify_deliveries_user_created`. */
export async function listDeliveries(
  db: NotifyD1Database,
  options: ListDeliveriesOptions,
): Promise<DeliveryRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 500)
  const { results } = await db
    .prepare(
      `SELECT * FROM notify_deliveries
       WHERE user_id = ?1 AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
       ORDER BY created_at DESC, id DESC LIMIT ?4`,
    )
    .bind(
      options.userId,
      options.before?.createdAt ?? Number.MAX_SAFE_INTEGER,
      options.before?.id ?? '',
      limit,
    )
    .all()
  return (results as DeliveryRow[]).map(toRecord)
}

/**
 * Delete audit rows older than `olderThan` (ms), at most `limit` per call so a
 * large backlog never becomes one long D1 write. Returns the rows deleted;
 * call again while it equals `limit`. The retention window is the app's choice.
 */
export async function pruneDeliveries(
  db: NotifyD1Database,
  options: { limit?: number; olderThan: number },
): Promise<number> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 1000), 1), 5000)
  const result = await db
    .prepare(
      `DELETE FROM notify_deliveries WHERE id IN
       (SELECT id FROM notify_deliveries WHERE created_at < ?1 ORDER BY created_at LIMIT ?2)`,
    )
    .bind(options.olderThan, limit)
    .run()
  return result.meta?.changes ?? 0
}
