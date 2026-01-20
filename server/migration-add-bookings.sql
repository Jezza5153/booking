-- Migration: Add bookings table and update constraints
-- Run this on your existing Railway PostgreSQL database

-- 1. Add bookings table if not exists
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
  table_type TEXT NOT NULL CHECK (table_type IN ('2','4','6','7+')),
  guest_count INTEGER NOT NULL CHECK (guest_count >= 1 AND guest_count <= 20),
  
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  remarks TEXT,
  
  idempotency_key TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled'))
);

-- 2. Add indexes
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_restaurant ON bookings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_unique 
ON bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3. Alter slots to use TIMESTAMPTZ (if not already)
-- Note: This may require data migration if existing data uses TIMESTAMP
-- ALTER TABLE slots ALTER COLUMN start_datetime TYPE TIMESTAMPTZ;

-- 4. Add CHECK constraints where missing (safe to run multiple times)
DO $$ 
BEGIN
  -- These will fail silently if constraints already exist
  EXECUTE 'ALTER TABLE slots ADD CONSTRAINT slots_booked_2_check CHECK (booked_count_2_tops >= 0)' ;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE bookings IS 'Audit trail for all booking transactions';
