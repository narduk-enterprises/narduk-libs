import { and, count, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, useDatabase } from '#layer/server/utils/database'
import { notifications } from '#narduk-core/schema'

import type { Notification } from '#narduk-core/schema'
import type { H3Event } from 'h3'

/**
 * In-app notification service.
 *
 * Provides CRUD operations for user-scoped notifications.
 * Downstream apps call `createNotification()` from their domain services
 * (e.g. after creating a wager, settling a payment, etc.).
 *
 * All functions require an H3Event for database access via `useDatabase()`.
 */

/** Input shape for creating a notification. */
export interface CreateNotificationInput {
  actionUrl?: string
  body: string
  icon?: string
  kind: string
  resourceId?: string
  resourceType?: string
  title: string
  userId: string
}

/** Options for listing notifications. */
export interface ListNotificationOptions {
  limit?: number
  /** Rows to skip. Without it a paged caller silently re-reads page one. */
  offset?: number
  unreadOnly?: boolean
}

/**
 * Create a new notification for a user.
 * Returns the generated notification ID.
 */
export async function createNotification(
  event: H3Event,
  input: CreateNotificationInput,
): Promise<string> {
  const db = useDatabase(event)
  const id = crypto.randomUUID()

  await db.insert(notifications).values({
    id,
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    icon: input.icon ?? null,
    actionUrl: input.actionUrl ?? null,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    isRead: false,
    readAt: null,
    createdAt: new Date().toISOString(),
  })

  return id
}

/**
 * Get notifications for a user, ordered newest-first.
 */
export async function getUserNotifications(
  event: H3Event,
  userId: string,
  options: ListNotificationOptions = {},
): Promise<Notification[]> {
  const db = useDatabase(event)
  const limit = Math.min(options.limit ?? 50, 100)
  const offset = Math.max(options.offset ?? 0, 0)

  const conditions = [eq(notifications.userId, userId)]
  if (options.unreadOnly) {
    conditions.push(eq(notifications.isRead, false))
  }

  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset)
}

/**
 * Get the count of unread notifications for a user.
 */
export async function getUnreadCount(event: H3Event, userId: string): Promise<number> {
  const db = useDatabase(event)

  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))

  return row?.value ?? 0
}

/**
 * Mark a single notification as read. Verifies ownership.
 */
export async function markNotificationAsRead(
  event: H3Event,
  notificationId: string,
  userId: string,
): Promise<void> {
  const db = useDatabase(event)
  const now = new Date().toISOString()

  const result = await executeDatabaseQuery<Array<typeof notifications.$inferSelect>>(
    db
      .update(notifications)
      .set({ isRead: true, readAt: now })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning(),
  )

  if (!result.length) {
    throw createError({ statusCode: 404, message: 'Notification not found.' })
  }
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllNotificationsAsRead(event: H3Event, userId: string): Promise<void> {
  const db = useDatabase(event)
  const now = new Date().toISOString()

  await db
    .update(notifications)
    .set({ isRead: true, readAt: now })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
}

/**
 * Delete a single notification. Verifies ownership.
 */
export async function deleteNotification(
  event: H3Event,
  notificationId: string,
  userId: string,
): Promise<void> {
  const db = useDatabase(event)

  const result = await executeDatabaseQuery<Array<typeof notifications.$inferSelect>>(
    db
      .delete(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning(),
  )

  if (!result.length) {
    throw createError({ statusCode: 404, message: 'Notification not found.' })
  }
}
