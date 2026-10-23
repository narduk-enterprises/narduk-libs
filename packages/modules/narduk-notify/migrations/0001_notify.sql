-- narduk-notify 0001: per-user preferences and the delivery audit log (D1).
-- Expand-only. Apply with the app's D1 migration runner.

-- A row exists only where a user changed a category's default.
CREATE TABLE notify_preferences (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'email')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category, channel)
);

-- One row per delivery attempt to one target, including suppressed ones.
-- target_ref is a SHA-256 of the device token or address, never the value.
CREATE TABLE notify_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'email')),
  push_type TEXT CHECK (push_type IN ('alert', 'background', 'liveactivity')),
  environment TEXT CHECK (environment IN ('development', 'production')),
  target_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed', 'skipped')),
  provider_id TEXT,
  status_code INTEGER,
  reason TEXT,
  token_invalid INTEGER NOT NULL DEFAULT 0 CHECK (token_invalid IN (0, 1))
);

CREATE INDEX notify_deliveries_user_created ON notify_deliveries (user_id, created_at DESC);
CREATE INDEX notify_deliveries_created ON notify_deliveries (created_at);
