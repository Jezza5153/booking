-- ============================================
-- MIGRATION: Multi-Table Group Bookings
-- Adds group_id + is_primary to support combining tables for large parties
-- ============================================

-- 1. Add group_id: links multiple booking rows for the same party
ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS group_id TEXT;

-- 2. Add is_primary: only one row per group triggers emails/CRM actions
ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT true;

-- 3. Index for fast group lookups
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_group ON restaurant_bookings(group_id) WHERE group_id IS NOT NULL;

-- 4. Index for overlap queries (table + date + time range)
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_overlap 
  ON restaurant_bookings(table_id, booking_date, start_time, end_time) 
  WHERE status != 'cancelled';

-- ✅ Migration complete!
-- Single-table bookings: group_id = booking id, is_primary = true
-- Multi-table bookings: all rows share same group_id, only first is is_primary = true
