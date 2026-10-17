-- Initial schema (SPEC §3). Times: *_at columns are UTC ISO-8601 strings.

CREATE TABLE events (
  id              TEXT PRIMARY KEY,                 -- ULID
  type            TEXT NOT NULL,                    -- see src/config/event-types.ts
  title           TEXT NOT NULL,
  description     TEXT,
  organizer       TEXT,                             -- optional public name
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  place_label     TEXT,
  municipality    TEXT NOT NULL,                    -- derived from CAOP
  district        TEXT NOT NULL,                    -- district or autonomous region
  tz              TEXT NOT NULL CHECK (tz IN ('Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores')),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'published', 'hidden')),
  verified        INTEGER NOT NULL DEFAULT 0,
  contact_email   TEXT,                             -- never public
  edit_token_hash TEXT NOT NULL,                    -- SHA-256 hex
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_events_status ON events(status);

CREATE TABLE event_occurrences (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  local_date  TEXT NOT NULL,                        -- 'YYYY-MM-DD' in the event tz
  start_time  TEXT,                                 -- 'HH:MM', NULL = all day
  end_time    TEXT,                                 -- 'HH:MM'
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  note        TEXT,
  cancelled   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_occ_starts ON event_occurrences(starts_at);
CREATE INDEX idx_occ_event ON event_occurrences(event_id);

CREATE TABLE event_reports (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reports_event ON event_reports(event_id);

CREATE TABLE signatures (
  id                   TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN ('individual', 'organization')),
  first_name           TEXT,
  last_name            TEXT,
  pseudonym            TEXT,
  activity             TEXT,
  org_name             TEXT,
  org_type             TEXT,
  contact_name         TEXT,                        -- never public
  website              TEXT,
  email                TEXT NOT NULL,               -- normalized; never public
  municipality         TEXT NOT NULL,
  phone                TEXT,                        -- never public
  is_public            INTEGER NOT NULL,
  can_contact          INTEGER NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('unconfirmed', 'confirmed', 'approved', 'rejected')),
  confirm_token_hash   TEXT,
  consent_text_version TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  confirmed_at         TEXT,
  UNIQUE (kind, email)
);
CREATE INDEX idx_sig_status ON signatures(status, created_at);
CREATE INDEX idx_sig_municipality ON signatures(municipality);
