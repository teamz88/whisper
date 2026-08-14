-- Whisper — initial schema
--
-- Requires PostgreSQL 13 or newer: gen_random_uuid() is built in from 13
-- onwards, so no pgcrypto extension (and no superuser) is needed.
--
-- Run once against a fresh database:
--   psql --single-transaction "$DATABASE_URL" -f server/migrations/001_initial.sql
-- or, from server/:
--   npm run migrate
--
-- No BEGIN/COMMIT in this file: the migrate runner wraps each file AND its
-- schema_migrations bookkeeping row in ONE transaction, and an inner COMMIT
-- would split them (applied-but-unrecorded on a crash). Everything here is
-- idempotent anyway, so re-running against a migrated database is a no-op.

-- ---------------------------------------------------------------------------
-- users
--
-- There is no public sign-up. Rows are created by the admin CLI
-- (npm run create-user) or POST /admin/users.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  full_name     text,
  role          text        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active     boolean     NOT NULL DEFAULT true,
  onboarded     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Logins look up by email; the unique constraint already indexes it, but
-- case-insensitive matching needs its own index. Emails are stored lowercased
-- by the application, and this guards against a row that slipped in otherwise.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- ---------------------------------------------------------------------------
-- user_settings
--
-- One row per user, created in the same transaction as the user (see
-- services/users.ts) rather than by a trigger, so the API owns the defaults.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
  user_id           uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  hotkey            text        NOT NULL DEFAULT 'HoldCtrlMeta',
  default_style     text        NOT NULL DEFAULT 'auto',
  language          text        NOT NULL DEFAULT 'en',
  ai_cleanup        boolean     NOT NULL DEFAULT true,
  history_storage   boolean     NOT NULL DEFAULT true,
  overlay_position  text        NOT NULL DEFAULT 'bottom-center',
  custom_vocabulary text        NOT NULL DEFAULT '',
  -- Forces the large-v3 model even for languages the turbo model handles well.
  high_accuracy     boolean     NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions
--
-- One row per stored dictation. Nothing is written here when the user has
-- history_storage turned off.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  raw_transcript     text        NOT NULL DEFAULT '',
  cleaned_transcript text        NOT NULL DEFAULT '',
  word_count         integer     NOT NULL DEFAULT 0,
  -- Real microphone time, from the client's audio start/stop timestamps.
  duration_ms        integer     NOT NULL DEFAULT 0,
  style              text        NOT NULL DEFAULT 'auto',
  language           text        NOT NULL DEFAULT 'en',
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Every read of this table is "this user's rows, newest first".
CREATE INDEX IF NOT EXISTS sessions_user_created_idx
  ON sessions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- refresh_tokens
--
-- Only a SHA-256 hash of each token is stored, so a database leak does not hand
-- out sessions. Rotated on every /auth/refresh: the presented row is deleted and
-- a new one inserted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_idx ON refresh_tokens (token_hash);
-- Lets the periodic sweep of expired rows use an index scan.
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx ON refresh_tokens (expires_at);
