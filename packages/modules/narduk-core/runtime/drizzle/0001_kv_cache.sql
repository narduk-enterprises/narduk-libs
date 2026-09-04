-- Add kv_cache table for D1-backed API response caching
-- Used by withD1Cache() from server/utils/d1Cache.ts

CREATE TABLE IF NOT EXISTS `kv_cache` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL
);
