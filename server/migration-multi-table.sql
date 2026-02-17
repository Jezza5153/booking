-- Multi-table booking: group_id and is_primary
-- This is the canonical migration; auto-migration in index.js mirrors this.

ALTER TABLE restaurant_bookings
  ADD COLUMN IF NOT EXISTS group_id TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing single bookings should be treated as primary
UPDATE restaurant_bookings
SET is_primary = true
WHERE group_id IS NULL AND is_primary = false;

-- Fast group lookups
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_group
  ON restaurant_bookings(group_id)
  WHERE group_id IS NOT NULL;

-- Optimized overlap + availability lookups (case-insensitive status)
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_lookup
  ON restaurant_bookings(restaurant_id, booking_date, table_id, start_time, end_time)
  WHERE lower(status) != 'cancelled';
