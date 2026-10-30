-- Event posters (SPEC §4.7, docs/decisions.md #79): at most one per event, in
-- R2 (POSTERS). Public only once a moderator approves it.
ALTER TABLE events ADD COLUMN poster_key TEXT;
ALTER TABLE events ADD COLUMN poster_status TEXT;
ALTER TABLE events ADD COLUMN poster_width INTEGER;
ALTER TABLE events ADD COLUMN poster_height INTEGER;
ALTER TABLE events ADD COLUMN poster_alt TEXT;
