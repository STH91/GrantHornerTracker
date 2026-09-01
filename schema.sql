-- Grant Horner Tracker schema (Cloudflare D1 / SQLite).
-- Apply with: npx wrangler d1 execute horner-tracker --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS account (
  id          TEXT PRIMARY KEY,
  pass_hash   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Ten rows per account: the whole of a reader's state.
CREATE TABLE IF NOT EXISTS position (
  account_id  TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  list_no     INTEGER NOT NULL,
  chapter_offset INTEGER NOT NULL DEFAULT 0,
  cycles      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, list_no)
);

-- One row per chapter marked read. Powers undo, and keeps the door open for
-- streaks and history later without a migration.
CREATE TABLE IF NOT EXISTS read_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  list_no     INTEGER NOT NULL,
  chapter_offset INTEGER NOT NULL,
  read_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS read_log_account_list ON read_log (account_id, list_no, id DESC);

CREATE TABLE IF NOT EXISTS session (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expires ON session (expires_at);

-- Per-IP attempt records for throttling sign-in and signup.
CREATE TABLE IF NOT EXISTS throttle (
  bucket      TEXT NOT NULL,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS throttle_bucket_at ON throttle (bucket, at);
