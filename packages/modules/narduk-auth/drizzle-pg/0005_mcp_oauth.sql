-- MCP OAuth authorization server storage (PostgreSQL mirror of
-- ../drizzle/0005_mcp_oauth.sql). Opt-in: nardukAuth.mcpOAuth.
-- @cloudflare/workers-oauth-provider stores clients, grants, codes and tokens
-- through a KV-shaped interface; this table is that interface. Token, code and
-- secret values are never stored: keys and records hold hashes.

-- key is COLLATE "C" on purpose: the store lists by prefix with a byte range
-- (key >= prefix AND key < prefix || U+10FFFF) and pages by key order, both of
-- which assume bytewise order as SQLite's BINARY collation gives. Under a
-- linguistic default (en_US.utf8, the stock postgres image) that range returns
-- the wrong keys. Do not drop the collation when copying this DDL.
CREATE TABLE IF NOT EXISTS auth_oauth_kv (
  key text COLLATE "C" PRIMARY KEY NOT NULL,
  value text NOT NULL,
  metadata text,
  expires_at bigint
);

CREATE INDEX IF NOT EXISTS auth_oauth_kv_expires ON auth_oauth_kv (expires_at);
