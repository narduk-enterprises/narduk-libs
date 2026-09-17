import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name'),
  passwordHash: text('password_hash'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at'),
})

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  kind: text('kind'),
  title: text('title'),
  body: text('body'),
  createdAt: text('created_at'),
})

export type User = typeof users.$inferSelect
export type Notification = typeof notifications.$inferSelect
