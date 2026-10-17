-- Phase 6: admin magic-link login (SPEC §6). Only SHA-256 hashes of tokens are stored.
CREATE TABLE admin_login_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE admin_sessions (
  id_hash    TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Retention job: events by last occurrence end.
CREATE INDEX idx_occ_event_ends ON event_occurrences(event_id, ends_at);
