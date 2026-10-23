import { NotifyError } from './errors.js'

import type { NotifyD1Database } from './d1.js'

export type NotifyChannel = 'email' | 'push'

export const NOTIFY_CHANNELS: readonly NotifyChannel[] = ['push', 'email']

export interface NotifyCategory {
  /** On or off for a user who never changed it. */
  defaults: Record<NotifyChannel, boolean>
  /** Channels a user cannot turn off, e.g. push for an anchor alarm. */
  mandatory?: readonly NotifyChannel[]
}

/** The app's categories, by id. Category ids are the app's own vocabulary. */
export type NotifyCategories = Readonly<Record<string, NotifyCategory>>

export interface ResolvedChannel {
  enabled: boolean
  source: 'default' | 'mandatory' | 'user'
}

export type ResolvedPreferences = Record<string, Record<NotifyChannel, ResolvedChannel>>

export interface SetPreferenceInput {
  category: string
  channel: NotifyChannel
  enabled: boolean
  userId: string
}

export interface NotifyPreferences {
  /** Every category and channel for one user, resolved in one query. */
  get: (userId: string) => Promise<ResolvedPreferences>
  /** Record a user's choice. Turning off a mandatory channel throws. */
  set: (input: SetPreferenceInput) => Promise<void>
}

interface PreferenceRow {
  category: string
  channel: NotifyChannel
  enabled: number
}

export function requireCategory(categories: NotifyCategories, id: string): NotifyCategory {
  const category = Object.hasOwn(categories, id) ? categories[id] : undefined
  if (!category) throw new NotifyError('unknown_category', `unknown notification category: ${id}`)
  return category
}

export function resolvePreferences(
  categories: NotifyCategories,
  rows: readonly PreferenceRow[],
): ResolvedPreferences {
  const overrides = new Map(rows.map((row) => [`${row.category}\u0000${row.channel}`, row.enabled]))
  const resolved: ResolvedPreferences = {}
  for (const [id, category] of Object.entries(categories)) {
    const channels = {} as Record<NotifyChannel, ResolvedChannel>
    for (const channel of NOTIFY_CHANNELS) {
      const override = overrides.get(`${id}\u0000${channel}`)
      channels[channel] = category.mandatory?.includes(channel)
        ? { enabled: true, source: 'mandatory' }
        : override === undefined
          ? { enabled: category.defaults[channel], source: 'default' }
          : { enabled: override === 1, source: 'user' }
    }
    resolved[id] = channels
  }
  return resolved
}

export function createNotifyPreferences(options: {
  categories: NotifyCategories
  db: NotifyD1Database
  now?: () => number
}): NotifyPreferences {
  const { categories, db } = options
  const now = options.now ?? Date.now

  return {
    get: async (userId) => {
      const { results } = await db
        .prepare('SELECT category, channel, enabled FROM notify_preferences WHERE user_id = ?1')
        .bind(userId)
        .all()
      return resolvePreferences(categories, results as PreferenceRow[])
    },
    set: async ({ userId, category, channel, enabled }) => {
      const definition = requireCategory(categories, category)
      if (!NOTIFY_CHANNELS.includes(channel)) {
        throw new NotifyError('unknown_channel', `unknown channel: ${String(channel)}`)
      }
      if (!enabled && definition.mandatory?.includes(channel)) {
        throw new NotifyError(
          'mandatory_channel',
          `${channel} cannot be turned off for ${category}`,
        )
      }
      await db
        .prepare(
          `INSERT INTO notify_preferences (user_id, category, channel, enabled, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (user_id, category, channel)
           DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
        )
        .bind(userId, category, channel, enabled ? 1 : 0, now())
        .run()
    },
  }
}
