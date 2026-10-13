-- Seed data for local development (run it after the migrations).
--
-- The seeded users carry no password hash, so none of them can sign in until
-- the app sets one. Re-running this file also clears any hash an older copy of
-- it wrote. To sign in locally, register through the app's own flow, or set a
-- hash generated with the layer's hashUserPassword() helper on a seeded row.
INSERT INTO users (id, email, password_hash, name, is_admin, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'demo@example.com', NULL, 'Demo User', 0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com', NULL, 'Admin User', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000003', 'admin@nard.uk', NULL, 'Narduk Admin', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  password_hash = excluded.password_hash,
  name = excluded.name,
  is_admin = excluded.is_admin,
  updated_at = excluded.updated_at;

INSERT OR IGNORE INTO todos (user_id, title, completed, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Set up local development', 1, '2025-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000001', 'Run database migrations', 1, '2025-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000001', 'Seed the database', 0, '2025-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000002', 'Review admin dashboard', 0, '2025-01-01T00:00:00.000Z');
