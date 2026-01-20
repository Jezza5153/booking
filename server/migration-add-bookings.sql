-- Migration: Add bookings table, FK constraints, and production-grade schema
-- Run this on your existing Railway PostgreSQL database

-- ============================================
-- 1. Create bookings table
-- ============================================
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  slot_id TEXT NOT NULL,  -- FK added below with RESTRICT
  table_type TEXT NOT NULL CHECK (table_type IN ('2','4','6','7+')),
  guest_count INTEGER NOT NULL CHECK (guest_count >= 1 AND guest_count <= 20),
  
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  remarks TEXT,
  
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);

-- ============================================
-- 2. Idempotency index (prevent duplicate bookings)
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_key_unique
ON bookings(idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- ============================================
-- 3. Performance indexes
-- ============================================
CREATE INDEX IF NOT EXISTS bookings_slot_id_idx ON bookings(slot_id);
CREATE INDEX IF NOT EXISTS bookings_restaurant_id_idx ON bookings(restaurant_id);
CREATE INDEX IF NOT EXISTS bookings_created_at_idx ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status);

-- ============================================
-- 4. FK constraints (as per senior dev review)
-- ============================================

-- events -> slots: CASCADE (deleting event deletes its slots)
ALTER TABLE slots
  DROP CONSTRAINT IF EXISTS slots_event_id_fkey;

ALTER TABLE slots
  ADD CONSTRAINT slots_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

-- slots -> bookings: RESTRICT (prevent deleting slot if bookings exist)
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_slot_id_fkey;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_slot_id_fkey
  FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE RESTRICT;

-- ============================================
-- 5. Migrate slots to TIMESTAMPTZ (if needed)
-- ============================================
-- NOTE: Only run if your column is TIMESTAMP, not TIMESTAMPTZ
-- First check your current type with: \d slots
-- If it's TIMESTAMP, uncomment and run:

-- ALTER TABLE slots
--   ALTER COLUMN start_datetime TYPE TIMESTAMPTZ
--   USING start_datetime AT TIME ZONE 'Europe/Amsterdam';

-- ============================================
-- 6. Add cancelled_at column to bookings (if not exists)
-- ============================================
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'bookings' AND column_name = 'cancelled_at') THEN
    ALTER TABLE bookings ADD COLUMN cancelled_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON TABLE bookings IS 'Audit trail for all booking transactions. Never delete, only mark cancelled.';
