-- Migration: Add description and price_per_person to events table
-- Run this on the Neon database

ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS price_per_person NUMERIC(10,2);

-- Verify the columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'events' 
AND column_name IN ('description', 'price_per_person');
