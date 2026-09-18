import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// ─── Users ──────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name'),
  appleId: text('apple_id').unique(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── Sessions ───────────────────────────────────────────────
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // session token
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(), // Unix timestamp
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)

// ─── Todos (Demo) ───────────────────────────────────────────
export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── KV Cache ───────────────────────────────────────────────
export const kvCache = sqliteTable('kv_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

// ─── API Keys ───────────────────────────────────────────────
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(), // UUID
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // Human label, e.g. "validate-fleet CLI"
    keyHash: text('key_hash').notNull(), // SHA-256 of raw key
    keyPrefix: text('key_prefix').notNull(), // First 8 chars for display: "nk_a1b2…"
    scopesJson: text('scopes_json').notNull().default('[]'),
    lastUsedAt: text('last_used_at'),
    expiresAt: integer('expires_at'), // Nullable unix timestamp
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index('api_keys_user_id_idx').on(table.userId)],
)

// ─── Notifications ──────────────────────────────────────────
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'system' | 'reminder' | 'social' | 'alert'
  title: text('title').notNull(),
  body: text('body').notNull(),
  icon: text('icon'), // Optional lucide icon name, e.g. 'i-lucide-bell'
  actionUrl: text('action_url'), // Optional deep-link path
  resourceType: text('resource_type'), // Optional domain entity type (e.g. 'wager', 'order')
  resourceId: text('resource_id'), // Optional domain entity ID
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  readAt: text('read_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── System Prompts ─────────────────────────────────────────
// Lives in `layer-core` so every app that extends core (with or without
// `layer-ai`) can resolve `#narduk-core/schema` → `systemPrompts` and
// `#layer/server/utils/systemPrompts`. The AI layer still ships a redundant
// mirror of the same shape under `#layer-ai/orm-tables` for backward
// compatibility with any app that pinned the old alias.
export const systemPrompts = sqliteTable('system_prompts', {
  name: text('name').primaryKey(),
  content: text('content').notNull(),
  description: text('description').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── Type helpers ───────────────────────────────────────────
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
