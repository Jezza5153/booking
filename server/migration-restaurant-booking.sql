-- Restaurant Booking System Migration
-- Run this on Neon database

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

-- 5. Default opening hours for demo-restaurant (Mon-Sun 17:00-23:00)
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

-- 6. Sample tables for demo-restaurant
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
