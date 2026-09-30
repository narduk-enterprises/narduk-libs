-- MCP OAuth authorization server storage (opt-in: nardukAuth.mcpOAuth).
-- @cloudflare/workers-oauth-provider stores clients, grants, codes and tokens
-- through a KV-shaped interface; this table is that interface on D1. Token,
-- code and secret values are never stored: keys and records hold hashes, and
-- grant props are AES-GCM encrypted by the library.
CREATE TABLE IF NOT EXISTS auth_oauth_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  metadata TEXT,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS auth_oauth_kv_expires ON auth_oauth_kv(expires_at);
