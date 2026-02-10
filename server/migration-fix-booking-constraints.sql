-- Migration: Fix booking constraints for large-group support
-- Issue: table_type NOT NULL blocks large-group bookings (7+ guests) where table_type is null
-- Issue: guest_count CHECK (1-20) is too restrictive, server allows up to 50
-- Date: 2026-02-10

-- 1. Allow NULL for table_type (large groups have tables_allocated JSON instead)
ALTER TABLE bookings ALTER COLUMN table_type DROP NOT NULL;

-- 2. Update CHECK constraint on table_type to also allow NULL
-- Must drop and recreate the constraint
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_table_type_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_table_type_check 
    CHECK (table_type IS NULL OR table_type IN ('2','4','6','7+'));

-- 3. Update guest_count ceiling from 20 to 50
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_guest_count_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_guest_count_check 
    CHECK (guest_count >= 1 AND guest_count <= 50);

-- 4. Add current_couverts column to slots if not exists (needed for couvert tracking)
ALTER TABLE slots ADD COLUMN IF NOT EXISTS current_couverts INTEGER DEFAULT 0;

-- 5. Add is_large_group and tables_allocated columns to bookings if not exists
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_large_group BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tables_allocated JSONB;

-- Verify
SELECT 'Migration complete: booking constraints updated' AS status;
