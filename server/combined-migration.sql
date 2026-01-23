-- ============================================
-- COMBINED MIGRATION: Restaurant Booking System
-- Run this entire script on Neon to set up the new table booking system
-- ============================================

-- =============================================
-- PART 1: Flexible Couvert & Table System
-- (From migration-flexible-tables.sql)
-- =============================================

-- 1. Add max_couverts to zones
ALTER TABLE zones ADD COLUMN IF NOT EXISTS max_couverts INTEGER;

-- Update existing zones with sensible defaults (sum of all seats)
UPDATE zones SET max_couverts = (capacity_2_tops * 2) + (capacity_4_tops * 4) + (capacity_6_tops * 6)
WHERE max_couverts IS NULL;

-- 2. New table for flexible table configuration
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

-- 3. Enhance bookings table for large groups
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_guest_count_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_guest_count_check CHECK (guest_count >= 1 AND guest_count <= 50);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_large_group BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tables_allocated JSONB;
ALTER TABLE bookings ALTER COLUMN table_type DROP NOT NULL;

-- 4. Add current_couverts counter to slots
ALTER TABLE slots ADD COLUMN IF NOT EXISTS current_couverts INTEGER DEFAULT 0;

-- Calculate current couverts from existing bookings
UPDATE slots s SET current_couverts = COALESCE((
  SELECT SUM(b.guest_count) 
  FROM bookings b 
  WHERE b.slot_id = s.id AND b.status = 'confirmed'
), 0);

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_zone_tables_zone ON zone_tables(zone_id);
CREATE INDEX IF NOT EXISTS idx_bookings_large_group ON bookings(is_large_group) WHERE is_large_group = true;

-- =============================================
-- PART 2: Restaurant Table Booking System
-- (From migration-restaurant-booking.sql)
-- =============================================

-- 1. Restaurant tables (individual tables, not zones)
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  name TEXT NOT NULL,      -- "Tafel 1", "Tafel 2", etc.
  seats INTEGER NOT NULL,  -- Number of seats
  zone TEXT,               -- Optional grouping: "Binnen", "Terras"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Restaurant openings (when is the restaurant open)
CREATE TABLE IF NOT EXISTS restaurant_openings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  restaurant_id TEXT NOT NULL,
  day_of_week INTEGER,     -- 0=Sunday, 1=Monday, ..., 6=Saturday (NULL for specific date)
  specific_date DATE,      -- For exceptions (holidays, special closures)
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  slot_duration_minutes INTEGER DEFAULT 90,  -- Default reservation duration
  is_closed BOOLEAN DEFAULT false,           -- True = restaurant closed this day
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Restaurant bookings (separate from event bookings)
CREATE TABLE IF NOT EXISTS restaurant_bookings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  restaurant_id TEXT NOT NULL,
  table_id TEXT REFERENCES restaurant_tables(id),
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  guest_count INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  remarks TEXT,
  status TEXT DEFAULT 'confirmed',  -- confirmed, cancelled, no_show
  source TEXT DEFAULT 'widget',     -- widget, phone, walk_in
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_date ON restaurant_bookings(restaurant_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_table ON restaurant_bookings(table_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_restaurant ON restaurant_tables(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_openings_restaurant ON restaurant_openings(restaurant_id);

-- =============================================
-- PART 3: Sample Data for demo-restaurant
-- =============================================

-- Default opening hours (Mon-Sun 17:00-23:00)
INSERT INTO restaurant_openings (restaurant_id, day_of_week, open_time, close_time)
VALUES 
  ('demo-restaurant', 0, '17:00', '23:00'),  -- Sunday
  ('demo-restaurant', 1, '17:00', '23:00'),  -- Monday
  ('demo-restaurant', 2, '17:00', '23:00'),  -- Tuesday
  ('demo-restaurant', 3, '17:00', '23:00'),  -- Wednesday
  ('demo-restaurant', 4, '17:00', '23:00'),  -- Thursday
  ('demo-restaurant', 5, '17:00', '23:00'),  -- Friday
  ('demo-restaurant', 6, '17:00', '23:00')   -- Saturday
ON CONFLICT DO NOTHING;

-- Sample tables
INSERT INTO restaurant_tables (id, restaurant_id, name, seats, zone)
VALUES
  ('t1', 'demo-restaurant', 'Tafel 1', 2, 'Binnen'),
  ('t2', 'demo-restaurant', 'Tafel 2', 2, 'Binnen'),
  ('t3', 'demo-restaurant', 'Tafel 3', 4, 'Binnen'),
  ('t4', 'demo-restaurant', 'Tafel 4', 4, 'Binnen'),
  ('t5', 'demo-restaurant', 'Tafel 5', 6, 'Binnen'),
  ('t6', 'demo-restaurant', 'Tafel 6', 2, 'Terras'),
  ('t7', 'demo-restaurant', 'Tafel 7', 4, 'Terras')
ON CONFLICT DO NOTHING;

-- ✅ Migration complete!
-- You can now use the "Tafels" tab in the admin panel
