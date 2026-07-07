-- System prompts table for app-configurable AI prompt content.
-- Moved from `layers/ai/drizzle/0000_system_prompts.sql` so apps that extend
-- `layer-core` without `layer-ai` still provision the table that
-- `#layer/server/utils/systemPrompts` targets. Mirrors the AI layer migration
-- (both use IF NOT EXISTS so running either order is safe).

CREATE TABLE IF NOT EXISTS `system_prompts` (
  `name` text PRIMARY KEY NOT NULL,
  `content` text NOT NULL,
  `description` text NOT NULL,
  `updated_at` text NOT NULL
);
