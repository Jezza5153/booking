-- Migration: Flexible Couvert & Tafel System
-- Adds max couverts per zone and flexible table configuration

-- =============================================
-- 1. Add max_couverts to zones
-- =============================================
ALTER TABLE zones ADD COLUMN IF NOT EXISTS max_couverts INTEGER;

-- Update existing zones with sensible defaults (sum of all seats)
UPDATE zones SET max_couverts = (capacity_2_tops * 2) + (capacity_4_tops * 4) + (capacity_6_tops * 6)
WHERE max_couverts IS NULL;

-- =============================================
-- 2. New table for flexible table configuration
-- =============================================
CREATE TABLE IF NOT EXISTS zone_tables (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  seats INTEGER NOT NULL CHECK (seats >= 1),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  booked_count INTEGER NOT NULL DEFAULT 0 CHECK (booked_count >= 0),
  UNIQUE(zone_id, seats)
);

-- Migrate existing capacity columns to zone_tables
INSERT INTO zone_tables (id, zone_id, seats, quantity, booked_count)
SELECT 
  'zt-' || z.id || '-2', z.id, 2, z.capacity_2_tops, 0
FROM zones z WHERE z.capacity_2_tops > 0
ON CONFLICT (zone_id, seats) DO NOTHING;

INSERT INTO zone_tables (id, zone_id, seats, quantity, booked_count)
SELECT 
  'zt-' || z.id || '-4', z.id, 4, z.capacity_4_tops, 0
FROM zones z WHERE z.capacity_4_tops > 0
ON CONFLICT (zone_id, seats) DO NOTHING;

INSERT INTO zone_tables (id, zone_id, seats, quantity, booked_count)
SELECT 
  'zt-' || z.id || '-6', z.id, 6, z.capacity_6_tops, 0
FROM zones z WHERE z.capacity_6_tops > 0
ON CONFLICT (zone_id, seats) DO NOTHING;

-- =============================================
-- 3. Enhance bookings table
-- =============================================
-- Allow larger guest counts
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_guest_count_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_guest_count_check CHECK (guest_count >= 1 AND guest_count <= 50);

-- Add columns for large group handling
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_large_group BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tables_allocated JSONB;
-- tables_allocated format: [{"seats": 6, "count": 1}, {"seats": 4, "count": 1}]

-- Make table_type nullable for multi-table bookings
ALTER TABLE bookings ALTER COLUMN table_type DROP NOT NULL;

-- =============================================
-- 4. Slot table for new flexible system
-- =============================================
-- Add current_couverts counter to slots for quick availability checks
ALTER TABLE slots ADD COLUMN IF NOT EXISTS current_couverts INTEGER DEFAULT 0;

-- Calculate current couverts from existing bookings
UPDATE slots s SET current_couverts = COALESCE((
  SELECT SUM(b.guest_count) 
  FROM bookings b 
  WHERE b.slot_id = s.id AND b.status = 'confirmed'
), 0);

-- =============================================
-- 5. Indexes for performance
-- =============================================
CREATE INDEX IF NOT EXISTS idx_zone_tables_zone ON zone_tables(zone_id);
CREATE INDEX IF NOT EXISTS idx_bookings_large_group ON bookings(is_large_group) WHERE is_large_group = true;
