-- Occurrences without an end time (or all day) now end at 06:00 local on the
-- next day instead of at midnight (docs/decisions.md #73). Recompute the stored
-- ends_at: 6 h after the old local midnight, 5 h when the next day is the March
-- DST Sunday, 7 h when it is the October one (all three PT zones switch on the
-- last Sunday of the month, between midnight and 06:00 local).
-- The hour guard skips rows already written with the new rule (05–07 UTC).
UPDATE event_occurrences
SET ends_at = strftime('%Y-%m-%dT%H:%M:%SZ', ends_at, (
  CASE
    WHEN strftime('%w', local_date, '+1 day') = '0'
      AND strftime('%m', local_date, '+1 day') <> strftime('%m', local_date, '+8 days')
      AND strftime('%m', local_date, '+1 day') = '03' THEN '+5 hours'
    WHEN strftime('%w', local_date, '+1 day') = '0'
      AND strftime('%m', local_date, '+1 day') <> strftime('%m', local_date, '+8 days')
      AND strftime('%m', local_date, '+1 day') = '10' THEN '+7 hours'
    ELSE '+6 hours'
  END
))
WHERE (start_time IS NULL OR end_time IS NULL)
  AND strftime('%H', ends_at) IN ('23', '00', '01');
