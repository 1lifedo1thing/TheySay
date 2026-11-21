-- TheySay local message history schema (SQLite / better-sqlite3)
-- Schema version: 1

CREATE TABLE IF NOT EXISTS targets (
  target_key TEXT PRIMARY KEY,
  handle TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'twitter',
  display_name TEXT NOT NULL DEFAULT '',
  user_handle TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL DEFAULT '',
  source_subtitle TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  is_muted INTEGER NOT NULL DEFAULT 1,
  last_fetched_at INTEGER,
  max_read_timestamp INTEGER NOT NULL DEFAULT 0,
  pinned_collapsed INTEGER NOT NULL DEFAULT 0,
  pinned_keys_json TEXT NOT NULL DEFAULT '[]',
  pinned_posts_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slots (
  slot_index INTEGER PRIMARY KEY,
  target_key TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'twitter',
  is_muted INTEGER NOT NULL DEFAULT 1,
  last_fetched_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  target_key TEXT NOT NULL,
  post_key TEXT NOT NULL,
  post_id TEXT NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL DEFAULT 0,
  is_unread INTEGER NOT NULL DEFAULT 1,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_member_only INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (target_key, post_key)
);

CREATE TABLE IF NOT EXISTS target_keys (
  target_key TEXT NOT NULL,
  post_key TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_known INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (target_key, post_key)
);

CREATE INDEX IF NOT EXISTS idx_posts_target_time
  ON posts (target_key, timestamp ASC, post_id ASC);
CREATE INDEX IF NOT EXISTS idx_posts_target_unread
  ON posts (target_key, is_unread);
CREATE INDEX IF NOT EXISTS idx_target_keys_read
  ON target_keys (target_key, is_read);
CREATE INDEX IF NOT EXISTS idx_targets_source
  ON targets (source);

