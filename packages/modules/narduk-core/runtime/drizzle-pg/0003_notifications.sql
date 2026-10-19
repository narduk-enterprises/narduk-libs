-- In-app notifications (PostgreSQL mirror of ../drizzle/0003_notifications.sql).
-- User-scoped, with optional resource linking for domain objects.

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  icon text,
  action_url text,
  resource_type text,
  resource_id text,
  is_read boolean NOT NULL DEFAULT false,
  read_at text,
  created_at text NOT NULL,
  CONSTRAINT notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read, created_at);
