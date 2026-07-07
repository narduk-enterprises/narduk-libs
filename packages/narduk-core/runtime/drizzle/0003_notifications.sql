-- In-app notifications table.
-- User-scoped with optional resource linking for domain objects.

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `icon` text,
  `action_url` text,
  `resource_type` text,
  `resource_id` text,
  `is_read` integer NOT NULL DEFAULT 0,
  `read_at` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_notifications_user_unread`
  ON `notifications` (`user_id`, `is_read`, `created_at`);
