-- system_prompts: app-configurable AI prompt content (PostgreSQL mirror of
-- ../drizzle/0005_system_prompts.sql). Apps that extend the core layer without
-- the AI layer still provision the table `systemPrompts` targets.

CREATE TABLE IF NOT EXISTS system_prompts (
  name text PRIMARY KEY NOT NULL,
  content text NOT NULL,
  description text NOT NULL,
  updated_at text NOT NULL
);
