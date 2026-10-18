-- Ongoing events ("sem fim", docs/decisions.md #74): set by a moderator, shown
-- every day from their first date until hidden or unmarked.
ALTER TABLE events ADD COLUMN ongoing INTEGER NOT NULL DEFAULT 0;
