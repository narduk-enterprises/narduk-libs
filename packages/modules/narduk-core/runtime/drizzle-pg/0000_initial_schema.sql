-- Initial schema: users, sessions and todos (PostgreSQL mirror of
-- ../drizzle/0000_initial_schema.sql and ../server/database/pg-schema.ts).
--
-- Run these files in name order with an immutable-file runner such as
-- @narduk-enterprises/narduk-postgres/migrate, or `psql -f` for a one-off.
-- Every statement is idempotent (IF NOT EXISTS), so re-running a file is safe.
--
-- Epoch columns are unix seconds. They are bigint, not integer, so a far-dated
-- expiry cannot overflow a 32-bit column (January 2038).

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  password_hash text,
  name text,
  apple_id text,
  is_admin boolean DEFAULT false,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_apple_id_unique UNIQUE (apple_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  expires_at bigint NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS todos (
  id serial PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  title text NOT NULL,
  completed boolean DEFAULT false,
  created_at text NOT NULL,
  CONSTRAINT todos_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
