-- kv_cache: API response cache (PostgreSQL mirror of ../drizzle/0001_kv_cache.sql).

CREATE TABLE IF NOT EXISTS kv_cache (
  key text PRIMARY KEY NOT NULL,
  value text NOT NULL,
  expires_at bigint NOT NULL
);
