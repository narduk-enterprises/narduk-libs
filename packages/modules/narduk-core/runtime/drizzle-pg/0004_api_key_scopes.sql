-- api_keys.scopes_json (PostgreSQL mirror of ../drizzle/0004_api_key_scopes.sql).

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes_json text NOT NULL DEFAULT '[]';
