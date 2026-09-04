-- API Keys table for bearer token authentication.
-- Keys are stored as SHA-256 hashes; the raw key is shown once on creation.
-- key_prefix stores the first 8 chars (e.g. "nk_a1b2c3") for display purposes.

CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `key_hash` text NOT NULL,
  `key_prefix` text NOT NULL,
  `last_used_at` text,
  `expires_at` integer,
  `created_at` text NOT NULL
);
