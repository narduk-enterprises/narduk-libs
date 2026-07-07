/**
 * PostgreSQL schema — pg-core mirror of `schema.ts` for Hyperdrive + `postgres.js`.
 *
 * Column names match the SQLite schema so migrations and queries stay aligned.
 * Build Workers with `NUXT_DATABASE_BACKEND=postgres` so `#layer/orm-tables` resolves here.
 */
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name'),
  appleId: text('apple_id').unique(),
  isAdmin: boolean('is_admin').default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const todos = pgTable('todos', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  completed: boolean('completed').default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const kvCache = pgTable('kv_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  scopesJson: text('scopes_json').notNull().default('[]'),
  lastUsedAt: text('last_used_at'),
  expiresAt: integer('expires_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  icon: text('icon'),
  actionUrl: text('action_url'),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  isRead: boolean('is_read').notNull().default(false),
  readAt: text('read_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

/**
 * `system_prompts` mirror for the Postgres path. Defined in core so
 * `#layer/orm-tables` keeps the same shape across backends even when an app
 * only extends `layer-core`. The AI layer preserves its own mirror for
 * backward compatibility with `#layer-ai/orm-tables`.
 */
export const systemPrompts = pgTable('system_prompts', {
  name: text('name').primaryKey(),
  content: text('content').notNull(),
  description: text('description').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type Todo = typeof todos.$inferSelect
export type NewTodo = typeof todos.$inferInsert
export type KvCacheEntry = typeof kvCache.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert
export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
export type SystemPrompt = typeof systemPrompts.$inferSelect
export type NewSystemPrompt = typeof systemPrompts.$inferInsert
