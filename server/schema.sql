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
  max_couverts INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Events Table (recurring or special events)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT, -- Short subtext under title
  price_per_person NUMERIC(10,2), -- Price in euros
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
  current_couverts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Bookings Table (audit trail for all bookings)
-- CRITICAL: This table provides booking history and audit trail
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
  table_type TEXT CHECK (table_type IS NULL OR table_type IN ('2','4','6','7+')),
  guest_count INTEGER NOT NULL CHECK (guest_count >= 1 AND guest_count <= 50),
  
  -- Customer information
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  remarks TEXT,
  
  -- Idempotency key for duplicate prevention
  idempotency_key TEXT,
  
  -- Large group support
  is_large_group BOOLEAN DEFAULT false,
  tables_allocated JSONB,
  
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
-- SEED DATA: See seed-data.sql (not for production)
-- =============================================
