-- EVENTS Database Schema for Railway PostgreSQL
-- Production-grade schema with proper constraints

-- 1. Restaurants Table
CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  booking_email TEXT,
  handoff_url_base TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Zones Table (seating areas per restaurant)
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity_2_tops INTEGER DEFAULT 0 CHECK (capacity_2_tops >= 0),
  capacity_4_tops INTEGER DEFAULT 0 CHECK (capacity_4_tops >= 0),
  capacity_6_tops INTEGER DEFAULT 0 CHECK (capacity_6_tops >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Events Table (recurring or special events)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Slots Table (bookable time slots)
-- Uses TIMESTAMPTZ for timezone-safe datetime handling
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  start_datetime TIMESTAMPTZ NOT NULL,
  is_highlighted BOOLEAN DEFAULT false,
  booked_count_2_tops INTEGER DEFAULT 0 CHECK (booked_count_2_tops >= 0),
  booked_count_4_tops INTEGER DEFAULT 0 CHECK (booked_count_4_tops >= 0),
  booked_count_6_tops INTEGER DEFAULT 0 CHECK (booked_count_6_tops >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Bookings Table (audit trail for all bookings)
-- CRITICAL: This table provides booking history and audit trail
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
  table_type TEXT NOT NULL CHECK (table_type IN ('2','4','6','7+')),
  guest_count INTEGER NOT NULL CHECK (guest_count >= 1 AND guest_count <= 20),
  
  -- Customer information
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  remarks TEXT,
  
  -- Idempotency key for duplicate prevention
  idempotency_key TEXT,
  
  -- Timestamps and status
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_zones_restaurant ON zones(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_events_restaurant ON events(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_events_active ON events(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_slots_event ON slots(event_id);
CREATE INDEX IF NOT EXISTS idx_slots_zone ON slots(zone_id);
CREATE INDEX IF NOT EXISTS idx_slots_datetime ON slots(start_datetime);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_restaurant ON bookings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_at ON bookings(cancelled_at);

-- Unique constraint on idempotency key to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_unique 
ON bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- =============================================
-- SEED DATA: Demo Restaurant
-- =============================================

-- Insert restaurant
INSERT INTO restaurants (id, name, booking_email, handoff_url_base) 
VALUES ('demo-restaurant', 'De Tafel', 'reserveren@tafelaaramersfoort.nl', 'https://booking.example.com/confirm')
ON CONFLICT (id) DO NOTHING;

-- Insert zones
INSERT INTO zones (id, restaurant_id, name, capacity_2_tops, capacity_4_tops, capacity_6_tops) VALUES
  ('zone-main', 'demo-restaurant', 'Binnen (Main)', 5, 5, 2),
  ('zone-terras', 'demo-restaurant', 'Terras (Sunny)', 8, 2, 0),
  ('zone-serre', 'demo-restaurant', 'Serre', 2, 4, 1)
ON CONFLICT (id) DO NOTHING;

-- Insert events
INSERT INTO events (id, restaurant_id, title, is_active) VALUES
  ('event-maandag', 'demo-restaurant', 'Makkelijke maandag', true),
  ('event-wijn', 'demo-restaurant', 'Wijn en spijs', true),
  ('event-theater', 'demo-restaurant', 'Theaterweekend', true)
ON CONFLICT (id) DO NOTHING;

-- Insert slots (using TIMESTAMPTZ with explicit timezone)
INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted, booked_count_2_tops, booked_count_4_tops, booked_count_6_tops) VALUES
  -- Makkelijke maandag
  ('slot-m1', 'event-maandag', 'zone-main', '2026-01-20 17:00:00+01', true, 0, 0, 0),
  ('slot-m2', 'event-maandag', 'zone-main', '2026-01-20 17:30:00+01', false, 0, 0, 0),
  ('slot-m3', 'event-maandag', 'zone-main', '2026-01-20 18:00:00+01', false, 0, 0, 0),
  -- Wijn en spijs
  ('slot-w1', 'event-wijn', 'zone-serre', '2026-01-24 18:30:00+01', false, 0, 0, 0),
  ('slot-w2', 'event-wijn', 'zone-serre', '2026-01-24 19:00:00+01', false, 0, 0, 0),
  -- Theaterweekend
  ('slot-t1', 'event-theater', 'zone-main', '2026-01-31 17:00:00+01', false, 0, 0, 0),
  ('slot-t2', 'event-theater', 'zone-main', '2026-01-31 17:15:00+01', false, 0, 0, 0),
  ('slot-t3', 'event-theater', 'zone-main', '2026-01-31 17:30:00+01', true, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;
